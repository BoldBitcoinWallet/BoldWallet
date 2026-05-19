package dkls

import (
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

type lanMessage struct {
	From  string `json:"from"`
	Body  string `json:"body"`
	SeqNo string `json:"sequence_no"`
	Hash  string `json:"hash"`
}

// startLANMessagePump polls the HTTP relay and delivers decoded libtss payloads.
func startLANMessagePump(server, session, sessionKey, key string, onBody func(string) error, endCh <-chan struct{}, wg *sync.WaitGroup) {
	defer wg.Done()
	msgMap := make(map[string]bool)
	until := time.Now().Add(120 * time.Second)

	for {
		select {
		case <-endCh:
			return
		case <-time.After(500 * time.Millisecond):
			if time.Now().After(until) {
				return
			}
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
				if msgMap[message.Hash] {
					lanDeleteMessage(server, session, key, message.Hash)
					continue
				}
				msgMap[message.Hash] = true
				body := message.Body
				if sessionKey != "" {
					body, err = tss.AesDecrypt(message.Body, sessionKey)
					if err != nil {
						continue
					}
				}
				if err := onBody(body); err != nil {
					continue
				}
				lanDeleteMessage(server, session, key, message.Hash)
			}
		}
	}
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
