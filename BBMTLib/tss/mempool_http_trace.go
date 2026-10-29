package tss

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

const mempoolBodyPreviewMax = 800

// Bound every mempool REST call so broadcast / discovery cannot hang forever
// (default http.Client has no timeout).
const mempoolHTTPTimeout = 15 * time.Second

func mempoolHTTPClient() *http.Client {
	return &http.Client{Timeout: mempoolHTTPTimeout}
}

func truncateMempoolPreview(s string) string {
	if len(s) <= mempoolBodyPreviewMax {
		return s
	}
	return s[:mempoolBodyPreviewMax] + "…"
}

// emitMempoolHTTP publishes a Hook payload so JS can show native mempool
// calls in the header Calls tab (type: mempool_http).
func emitMempoolHTTP(method, url string, status int, durationMs int64, timeout bool, bodyPreview, errMsg string) {
	payload := map[string]interface{}{
		"time":        time.Now().Unix(),
		"type":        "mempool_http",
		"method":      method,
		"url":         url,
		"status":      status,
		"durationMs":  durationMs,
		"timeout":     timeout,
		"bodyPreview": truncateMempoolPreview(bodyPreview),
	}
	if errMsg != "" {
		payload["error"] = errMsg
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	Hook(string(b))
}

func isHTTPTimeout(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline exceeded")
}

// mempoolHTTPGet is the single GET path for mempool REST from Go.
func mempoolHTTPGet(url string) (body []byte, status int, err error) {
	started := time.Now()
	resp, err := mempoolHTTPClient().Get(url)
	duration := time.Since(started).Milliseconds()
	if err != nil {
		emitMempoolHTTP("GET", url, 0, duration, isHTTPTimeout(err), "", err.Error())
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		emitMempoolHTTP("GET", url, resp.StatusCode, duration, false, "", readErr.Error())
		return nil, resp.StatusCode, readErr
	}
	emitMempoolHTTP("GET", url, resp.StatusCode, duration, false, string(body), "")
	return body, resp.StatusCode, nil
}

// mempoolHTTPPost is the single POST path for mempool REST from Go (broadcast).
func mempoolHTTPPost(url, bodyText string) (body []byte, status int, err error) {
	started := time.Now()
	req, err := http.NewRequest("POST", url, bytes.NewBufferString(bodyText))
	if err != nil {
		emitMempoolHTTP("POST", url, 0, 0, false, "", err.Error())
		return nil, 0, err
	}
	resp, err := mempoolHTTPClient().Do(req)
	duration := time.Since(started).Milliseconds()
	if err != nil {
		emitMempoolHTTP("POST", url, 0, duration, isHTTPTimeout(err), "", err.Error())
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		emitMempoolHTTP("POST", url, resp.StatusCode, duration, false, "", readErr.Error())
		return nil, resp.StatusCode, readErr
	}
	emitMempoolHTTP("POST", url, resp.StatusCode, duration, false, string(body), "")
	return body, resp.StatusCode, nil
}
