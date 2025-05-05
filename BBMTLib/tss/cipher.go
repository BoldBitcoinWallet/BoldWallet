package tss

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	eciesgo "github.com/ecies/go/v2"
)

func GenerateKeyPair() (string, error) {
	privKey, err := eciesgo.GenerateKey()
	if err != nil {
		return "", err
	}
	pubKey := privKey.PublicKey

	keyPair := map[string]string{
		"privateKey": privKey.Hex(),
		"publicKey":  pubKey.Hex(true),
	}

	keyPairJSON, err := json.Marshal(keyPair)
	if err != nil {
		return "", fmt.Errorf("failed to marshal key pair to JSON: %w", err)
	}

	return string(keyPairJSON), nil
}

func EciesEncrypt(data, publicKeyHex string) (string, error) {
	publicKey, err := eciesgo.NewPublicKeyFromHex(publicKeyHex)
	if err != nil {
		return "", fmt.Errorf("failed to decode public key: %w", err)
	}
	encryptedData, err := eciesgo.Encrypt(publicKey, []byte(data))
	if err != nil {
		return "", fmt.Errorf("failed to encrypt data: %w", err)
	}
	encodedData := base64.StdEncoding.EncodeToString(encryptedData)
	return encodedData, nil
}

func EciesDecrypt(encryptedData, privateKeyHex string) (string, error) {
	privateKey, err := eciesgo.NewPrivateKeyFromHex(privateKeyHex)
	if err != nil {
		return "", fmt.Errorf("failed to decode private key: %w", err)
	}
	encryptedBytes, err := base64.StdEncoding.DecodeString(encryptedData)
	if err != nil {
		return "", fmt.Errorf("failed to decode encrypted data: %w", err)
	}
	decryptedData, err := eciesgo.Decrypt(privateKey, encryptedBytes)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt data: %w", err)
	}
	return string(decryptedData), nil
}
