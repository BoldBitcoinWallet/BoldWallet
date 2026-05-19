package dkls

import (
	"encoding/base64"
	"fmt"

	libtss "github.com/0xCarbon/libtss/libtss-go/tss"
)

// EncodeMessages serializes libtss messages for transport (base64 TLV blob).
func EncodeMessages(msgs []libtss.Message) (string, error) {
	blob, err := libtss.BuildMessages(msgs)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(blob), nil
}

// DecodeMessages deserializes a transport payload into libtss messages.
func DecodeMessages(body string) ([]libtss.Message, error) {
	raw, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		return nil, fmt.Errorf("decode transport body: %w", err)
	}
	return libtss.ParseMessages(raw)
}
