package nostrtransport

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

func encryptAES(sessionKeyHex string, payload []byte) ([]byte, error) {
	key, err := hex.DecodeString(sessionKeyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid session key: %w", err)
	}
	if len(key) != 16 && len(key) != 24 && len(key) != 32 {
		return nil, fmt.Errorf("invalid AES key length: %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	padded := pkcs7Pad(payload, aes.BlockSize)
	iv := make([]byte, aes.BlockSize)
	if _, err := rand.Read(iv); err != nil {
		return nil, err
	}
	ciphertext := make([]byte, len(iv)+len(padded))
	copy(ciphertext, iv)
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(ciphertext[len(iv):], padded)
	return ciphertext, nil
}

func decryptAES(sessionKeyHex string, ciphertext []byte) ([]byte, error) {
	key, err := hex.DecodeString(sessionKeyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid session key: %w", err)
	}
	if len(ciphertext) < aes.BlockSize {
		return nil, fmt.Errorf("ciphertext too short")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	iv := ciphertext[:aes.BlockSize]
	body := make([]byte, len(ciphertext)-aes.BlockSize)
	copy(body, ciphertext[aes.BlockSize:])
	if len(body)%aes.BlockSize != 0 {
		return nil, fmt.Errorf("ciphertext not a multiple of block size")
	}
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(body, body)
	return pkcs7Unpad(body)
}

func pkcs7Pad(data []byte, blockSize int) []byte {
	padding := blockSize - len(data)%blockSize
	pad := bytesRepeat(byte(padding), padding)
	return append(data, pad...)
}

func pkcs7Unpad(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("invalid padding")
	}
	padding := int(data[len(data)-1])
	if padding == 0 || padding > len(data) {
		return nil, fmt.Errorf("invalid padding length")
	}
	return data[:len(data)-padding], nil
}

func bytesRepeat(b byte, count int) []byte {
	buf := make([]byte, count)
	for i := range buf {
		buf[i] = b
	}
	return buf
}
