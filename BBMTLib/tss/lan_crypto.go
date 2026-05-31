package tss

import (
	"fmt"
	"strings"
)

// DeriveLANSessionKey returns the AES session key used for trio LAN (and legacy duo DKLS tests).
// Matches mobile: sha256(sessionID + "," + masterHost).
func DeriveLANSessionKey(sessionID, masterHost string) (string, error) {
	seed := strings.Join([]string{sessionID, masterHost}, ",")
	return Sha256(seed)
}

// ConfigureLANTransportKeys sets global ECIES keys used by MessengerImp when sessionKey is empty.
// Either sessionKey (trio AES) or both encKey and decKey (duo ECIES) must be provided.
func ConfigureLANTransportKeys(sessionKey, encKey, decKey string) error {
	if len(sessionKey) > 0 && (len(encKey) > 0 || len(decKey) > 0) {
		return fmt.Errorf("either a session key, either enc/dec keys")
	}
	if len(sessionKey) == 0 && (len(encKey) == 0 || len(decKey) == 0) {
		return fmt.Errorf("either a session key, either both enc/dec keys")
	}
	keyMutex.Lock()
	encryptionKey = encKey
	decryptionKey = decKey
	keyMutex.Unlock()
	return nil
}

// ClearLANTransportKeys clears ECIES keys after a LAN MPC session.
func ClearLANTransportKeys() {
	keyMutex.Lock()
	encryptionKey = ""
	decryptionKey = ""
	keyMutex.Unlock()
}

// DecryptLANRelayPayload decrypts a relay message body (AES or ECIES), matching downloadMessage.
func DecryptLANRelayPayload(ciphertext, sessionKey string) (string, error) {
	if len(sessionKey) > 0 {
		return AesDecrypt(ciphertext, sessionKey)
	}
	keyMutex.RLock()
	decKey := decryptionKey
	keyMutex.RUnlock()
	if len(decKey) == 0 {
		return "", fmt.Errorf("LAN transport: missing decryption key")
	}
	return EciesDecrypt(ciphertext, decKey)
}
