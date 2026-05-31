package tss

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"testing"
	"time"
)

func freeTestPort(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	return strconv.Itoa(port)
}

func TestValidatePublishHandshakeQuery_Duo(t *testing.T) {
	peerPub := "037e159a7a1b84e9171b220c1c3bdceb19aa942baf12d4076a7cc2d802a6265f55"
	if !validatePublishHandshakeQuery("duo", peerPub, peerPub, "abc123") {
		t.Fatal("expected valid duo handshake query")
	}
	if validatePublishHandshakeQuery("duo", peerPub, "", "abc123") {
		t.Fatal("expected missing pubkey to fail-join")
	}
	if validatePublishHandshakeQuery("duo", peerPub, peerPub, "") {
		t.Fatal("expected missing data to reject")
	}
	if validatePublishHandshakeQuery("duo", peerPub, "02other", "abc123") {
		t.Fatal("expected pubkey mismatch to reject")
	}
}

func TestPublishData_IgnoresProbeUntilValidHandshake(t *testing.T) {
	if testing.Short() {
		t.Skip("publish handshake integration")
	}

	kpJSON, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair: %v", err)
	}
	var kp struct {
		PrivateKey string `json:"privateKey"`
		PublicKey  string `json:"publicKey"`
	}
	if err := json.Unmarshal([]byte(kpJSON), &kp); err != nil {
		t.Fatalf("parse keypair: %v", err)
	}

	port := freeTestPort(t)
	_, _ = StopRelay()
	releaseLanHandshakePort()
	time.Sleep(100 * time.Millisecond)

	done := make(chan struct {
		result string
		err    error
	}, 1)
	go func() {
		r, e := PublishData(port, "3", kp.PublicKey, "attempt:seedpayload", "duo")
		done <- struct {
			result string
			err    error
		}{r, e}
	}()

	time.Sleep(200 * time.Millisecond)
	client := &http.Client{Timeout: 500 * time.Millisecond}

	// Relay/probe-style GET without handshake query must not complete publish.
	if resp, err := client.Get("http://127.0.0.1:" + port + "/"); err == nil {
		resp.Body.Close()
	}

	select {
	case out := <-done:
		if out.err == nil && out.result != "" {
			t.Fatalf("probe GET should not complete publish, got %q", out.result)
		}
	case <-time.After(400 * time.Millisecond):
	}

	checksum := "837cf0ba4c1124322862f2f2c198e6d85eededdb8efc2e2d3b7a2d886de4c8c3"
	handshakeURL := "http://127.0.0.1:" + port + "/?data=" + checksum + "&pubkey=" + kp.PublicKey
	resp, err := client.Get(handshakeURL)
	if err != nil {
		t.Fatalf("handshake GET: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("handshake status: %d", resp.StatusCode)
	}

	select {
	case out := <-done:
		if out.err != nil {
			t.Fatalf("PublishData err: %v", out.err)
		}
		if out.result == "" {
			t.Fatal("expected non-empty publish result after valid handshake")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("PublishData did not complete after valid handshake")
	}
}
