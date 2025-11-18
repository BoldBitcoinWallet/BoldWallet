package tss

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func ListenForPeers(id, pubkey, port, timeout, mode string) (string, error) {
	Logln("BBMTLog", "Listening for peer...")

	// Channel to capture the peer IP (buffered to prevent deadlocks)
	peerFound := make(chan string, 1)
	stopServer := make(chan struct{})

	// Determine listen mode: default duo (expect 1 peer). If mode == "trio", expect 2 peers
	expectedPeers := 1
	if strings.EqualFold(mode, "trio") {
		expectedPeers = 2
	}
	// Track unique peer IPs and their payloads for trio mode
	peerIPs := make(map[string]struct{})
	ipToPayload := make(map[string]string)
	collectedIPs := make([]string, 0, expectedPeers)

	// Ensure no existing server is running on this port
	if isPortInUse(port) {
		Logln("BBMTLog", "Port", port, "is already in use. Stopping previous server...")
		StopRelay()
		time.Sleep(1 * time.Second) // Ensure cleanup
	}

	// HTTP handler to detect peer IP
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-stopServer:
			return // Stop handling requests when shutdown is triggered
		default:
		}

		clientIP, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			Logln("BBMTLog", "Error getting client IP:", err)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}

		Logf("BBMTLog Got a peer connection from %s\n", clientIP)

		srcIP := r.URL.Query().Get("src")
		dstIP := r.URL.Query().Get("dst")
		srcId := r.URL.Query().Get("id")
		srcPubkey := r.URL.Query().Get("pubkey")

		if srcIP != "" && dstIP != "" && srcPubkey != "" {
			go func(remoteAddr string) {
				client := http.Client{Timeout: 2 * time.Second}
				srcIPParsed, _, _ := net.SplitHostPort(remoteAddr)
				url := "http://" + srcIPParsed + ":" + port + "/?src=" + dstIP + "&dst=" + srcIPParsed + "&id=" + id + "&pubkey=" + pubkey
				Logln("BBMTLog", "Sending callback to:", url)
				_, err := client.Get(url)
				if err != nil {
					Logln("BBMTLog", "Error in callback:", err)
				}
			}(r.RemoteAddr)

			if expectedPeers == 1 {
				// Duo mode: keep existing payload format, try non-blocking send
				select {
				case peerFound <- clientIP + "@" + srcId + "@" + srcPubkey + "," + dstIP + "@" + id + "@" + pubkey:
				default:
				}
			} else {
				// Trio mode: collect unique client IPs and emit two payloads joined by '|'
				if _, exists := peerIPs[clientIP]; !exists {
					peerIPs[clientIP] = struct{}{}
					payload := clientIP + "@" + srcId + "@" + srcPubkey + "," + dstIP + "@" + id + "@" + pubkey
					ipToPayload[clientIP] = payload
					collectedIPs = append(collectedIPs, clientIP)
					if len(collectedIPs) >= expectedPeers {
						// Build pipe-separated payloads in order of collection
						combined := ipToPayload[collectedIPs[0]] + "|" + ipToPayload[collectedIPs[1]]
						select {
						case peerFound <- combined:
						default:
						}
					}
				}
			}
		}

		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, dstIP+"@"+id+"@"+pubkey+","+clientIP+"@"+srcId+"@"+srcPubkey)
	})

	// Create and start server
	server := &http.Server{Addr: "0.0.0.0:" + port, Handler: mux}
	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		Logln("BBMTLog", "Error binding to port:", err)
		return "", err
	}

	// Start HTTP server
	go func() {
		Logln("BBMTLog", "Waiting for peer connection on port:", port, ", timeout:", timeout)
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			Logln("BBMTLog", "HTTP server error:", err)
		}
	}()

	// Convert timeout to int
	tout, err := strconv.Atoi(timeout)
	if err != nil {
		tout = 30
	}

	select {
	case peerIPs := <-peerFound:
		Logln("BBMTLog", "Peer detected, shutting down server...")
		Logln("BBMTLog", "Forcefully stopping server...")
		// signal handler to stop accepting new work
		close(stopServer)
		time.Sleep(2 * time.Second)
		listener.Close()
		server.Close()
		return peerIPs, nil
	case <-time.After(time.Duration(tout) * time.Second):
		Logln("BBMTLog", "Timeout reached, shutting down server...")
		// signal handler to stop accepting new work
		close(stopServer)
		listener.Close()
		server.Close()
		return "", fmt.Errorf("timeout waiting for peer connection")
	}
}

// Check if the port is in use
func isPortInUse(port string) bool {
	conn, err := net.DialTimeout("tcp", "localhost:"+port, 500*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func DiscoverPeers(id, pubkey, localIP, remoteIPsCSV, port, timeout, mode string) (string, error) {
	if localIP == "" {
		return "", fmt.Errorf("no local IP detected, skipping peer discovery")
	}

	baseIP := localIP[:strings.LastIndex(localIP, ".")+1]
	peerFound := make(chan string)
	// Determine expected peers based on mode (duo=1, trio=2)
	expectedPeers := 1
	if strings.EqualFold(mode, "trio") {
		expectedPeers = 2
	}
	tout, err := strconv.Atoi(timeout)
	if err != nil {
		tout = 30
	}
	if tout < 5 {
		tout = 5
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(tout)*time.Second)
	defer cancel()

	client := &http.Client{Timeout: 2000 * time.Millisecond}

	// Trio mode aggregation state
	foundIPs := make(map[string]struct{})
	foundPayloads := make([]string, 0, expectedPeers)

	// Function to check a given IP
	checkPeer := func(ip string) {
		select {
		case <-ctx.Done():
			return
		default:
			url := "http://" + ip + "/?src=" + localIP + "&dst=" + ip + "&id=" + id + "&pubkey=" + pubkey
			resp, err := client.Get(url)
			if err == nil && resp.StatusCode == http.StatusOK {
				Logf("Peer discovered at: %s\n", ip)
				bodyBytes, err := io.ReadAll(resp.Body)
				if err == nil {
					payload := string(bodyBytes)
					if expectedPeers == 1 {
						// Duo: return immediately
						peerFound <- payload
						cancel()
					} else {
						// Trio: aggregate two distinct IPs
						host := ip
						if idx := strings.LastIndex(ip, ":"); idx != -1 {
							host = ip[:idx]
						}
						if _, ok := foundIPs[host]; !ok {
							foundIPs[host] = struct{}{}
							foundPayloads = append(foundPayloads, payload)
							if len(foundPayloads) >= expectedPeers {
								combined := strings.Join(foundPayloads, "|")
								peerFound <- combined
								cancel()
							}
						}
					}
				}
			}
		}
	}

	// First, check any provided remote IPs (comma-separated), skipping self
	if strings.TrimSpace(remoteIPsCSV) != "" {
		for _, rip := range strings.Split(remoteIPsCSV, ",") {
			rip = strings.TrimSpace(rip)
			if rip != "" && rip != localIP {
				checkPeer(fmt.Sprintf("%s:%s", rip, port))
			}
		}
	}

	// Scan the local subnet
	for i := 1; i <= 254; i++ {
		targetIP := fmt.Sprintf("%s%d", baseIP, i)
		if targetIP == localIP {
			Logln("BBMTLog", "skip self peer")
			continue
		}
		go checkPeer(fmt.Sprintf("%s:%s", targetIP, port))
		time.Sleep(10 * time.Millisecond)
	}

	select {
	case peerData := <-peerFound:
		return peerData, nil
	case <-ctx.Done():
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("peer discovery timed out after %d seconds", tout)
		}
		return "", fmt.Errorf("peer discovery stopped")
	}
}

func FetchData(url, decKey, data string) (string, error) {
	client := http.Client{
		Timeout: 5 * time.Second,
	}
	Logln("BBMTLog", "checking for peer connection:", url)
	pubkey, err := EciesPubkeyFromPrivateKey(decKey)
	if err != nil {
		return "", fmt.Errorf("failed to get public key from private key: %w", err)
	}

	resp, err := client.Get(url + "?data=" + data + "&pubkey=" + pubkey)
	if err != nil {
		return "", fmt.Errorf("error getting data: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("error getting data: status code %d", resp.StatusCode)
	}
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}
	decryptedData, err := EciesDecrypt(string(bodyBytes), decKey)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt chaincode: %w", err)
	}
	Logln("data decrypted successfully")
	return decryptedData, nil
}

func PublishData(port, timeout, enckey, data, mode string) (string, error) {
	Logln("BBMTLog", "publishing data...")
	published := make(chan string)
	expected := 1
	if strings.EqualFold(mode, "trio") {
		expected = 2
	}
	// Track distinct client IPs and their payloads
	clientIPs := make(map[string]struct{})
	payloads := make([]string, 0, expected)
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Determine encryption key per request
		selectedPub := enckey
		if expected == 2 { // trio mode
			// enckey CSV provided in function parameter
			allowed := map[string]struct{}{}
			for _, k := range strings.Split(enckey, ",") {
				k = strings.TrimSpace(k)
				if k != "" {
					allowed[k] = struct{}{}
				}
			}
			// read client-provided pubkey from query
			qPub := r.URL.Query().Get("pubkey")
			if _, ok := allowed[qPub]; !ok {
				// Not an expected key; ignore this request
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			selectedPub = qPub
		}

		encryptedData, err := EciesEncrypt(data, selectedPub)
		if err != nil {
			http.Error(w, "error", http.StatusInternalServerError)
			Logln("BBMTLog", "error publishing:", err)
			published <- "error"
			return
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, encryptedData)

		if expected == 1 {
			// duo: return first query observed
			published <- r.URL.RawQuery
			return
		}
		// trio: collect distinct client IPs and emit when 2 unique are served
		clientIP, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			clientIP = r.RemoteAddr
		}
		if _, ok := clientIPs[clientIP]; !ok {
			clientIPs[clientIP] = struct{}{}
			payloads = append(payloads, r.URL.RawQuery)
			if len(payloads) >= expected {
				combined := strings.Join(payloads, "|")
				published <- combined
			}
		}
	})

	if server != nil {
		StopRelay()
	}

	// Create and start server
	server := &http.Server{Addr: "0.0.0.0:" + port, Handler: mux}
	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		Logln("BBMTLog", "Error binding to port:", err)
		return "", err
	}

	// Start HTTP server
	go func() {
		Logln("BBMTLog", "Waiting for peer connection on port:", port, ", timeout:", timeout)
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			Logln("BBMTLog", "HTTP server error:", err)
		}
	}()

	tout, err := strconv.Atoi(timeout)
	if err != nil {
		tout = 30
	}

	select {
	case data := <-published:
		Logln("BBMTLog", "published. received:", data)
		time.Sleep(1000)
		listener.Close()
		server.Close()
		return data, nil
	case <-time.After(time.Duration(tout) * time.Second):
		Logln("BBMTLog", "Timeout reached, shutting down server...")
		listener.Close()
		server.Close()
		return "", fmt.Errorf("timeout waiting for peer connection")
	}
}
