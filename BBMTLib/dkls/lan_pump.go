package dkls

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

func lanPumpInterval() time.Duration {
	if v := os.Getenv("DKLS_LAN_PUMP_MS"); v != "" {
		if ms, err := strconv.Atoi(v); err == nil && ms > 0 {
			return time.Duration(ms) * time.Millisecond
		}
	}
	return 500 * time.Millisecond
}

type lanMessage struct {
	From  string `json:"from"`
	Body  string `json:"body"`
	SeqNo string `json:"sequence_no"`
	Hash  string `json:"hash"`
}

// startLANMessagePump polls the HTTP relay and delivers decoded libtss payloads.
func startLANMessagePump(server, session, sessionKey, key string, onBody func(string) error, endCh <-chan struct{}, wg *sync.WaitGroup) {
	defer wg.Done()
	defer recoverGoroutine("startLANMessagePump")
	msgMap := make(map[string]bool)
	bodyDelivered := make(map[string]bool)

	for {
		select {
		case <-endCh:
			return
		case <-time.After(lanPumpInterval()):
			resp, err := http.Get(server + "/message/" + session + "/" + key)
			if err != nil {
				continue
			}
			if resp.StatusCode != http.StatusOK {
				resp.Body.Close()
				continue
			}
			bodyBytes, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				continue
			}
			var messages []lanMessage
			if err := json.Unmarshal(bodyBytes, &messages); err != nil {
				continue
			}
			sort.SliceStable(messages, func(i, j int) bool {
				a, _ := strconv.Atoi(messages[i].SeqNo)
				b, _ := strconv.Atoi(messages[j].SeqNo)
				return a < b
			})
			for _, message := range messages {
				if message.From == key {
					continue
				}
				body, err := tss.DecryptLANRelayPayload(message.Body, sessionKey)
				if err != nil {
					dklsLogErrorf("pump decrypt %s from %s: %v", key, message.From, err)
					continue
				}
				bodyKey := message.From + ":" + md5Hex(body)
				if bodyDelivered[bodyKey] {
					if !msgMap[message.Hash] {
						lanDeleteMessage(server, session, key, message.Hash)
					}
					continue
				}
				if msgMap[message.Hash] {
					lanDeleteMessage(server, session, key, message.Hash)
					continue
				}
				if err := onBody(body); err != nil {
					continue
				}
				msgMap[message.Hash] = true
				bodyDelivered[bodyKey] = true
				lanDeleteMessage(server, session, key, message.Hash)
			}
		}
	}
}

func md5Hex(s string) string {
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

func lanDeleteMessage(server, session, key, hash string) {
	req, _ := http.NewRequest(http.MethodDelete, server+"/message/"+session+"/"+key+"/"+hash, nil)
	if req != nil {
		resp, err := http.DefaultClient.Do(req)
		if err == nil && resp != nil {
			resp.Body.Close()
		}
	}
}
