package tss

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestCompletedKeygenAccumulatesParties(t *testing.T) {
	port := freeTestPort(t)
	_, _ = StopRelay()
	time.Sleep(150 * time.Millisecond)
	if _, err := RunRelay(port); err != nil {
		t.Fatalf("RunRelay: %v", err)
	}
	t.Cleanup(func() { _, _ = StopRelay() })
	time.Sleep(1200 * time.Millisecond)

	server := "http://127.0.0.1:" + port
	session := "test-complete-accumulate"
	client := &http.Client{Timeout: 2 * time.Second}

	post := func(party string) {
		t.Helper()
		body, _ := json.Marshal([]string{party})
		resp, err := client.Post(server+"/complete/keygen/"+session, "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatalf("POST complete %s: %v", party, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("POST complete %s status %s", party, resp.Status)
		}
	}
	post("KeyShare1")
	post("KeyShare2")
	post("KeyShare1")

	resp, err := client.Get(server + "/complete/keygen/" + session)
	if err != nil {
		t.Fatalf("GET complete: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET complete status %s", resp.Status)
	}
	var got []string
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !equalUnordered(got, []string{"KeyShare1", "KeyShare2"}) {
		t.Fatalf("got %v want KeyShare1,KeyShare2", got)
	}
}
