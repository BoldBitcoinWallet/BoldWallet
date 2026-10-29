package main

// F15b-1 staged-handle cgo exports. Resolved-to-JS values carry
// handles + metadata ONLY. BbmtFinalizeStagedForPersist returns
// full keyshare JSON for NATIVE-ONLY envelope+RNES persist and
// must never resolve to JS.
//
// NOTE: no nil guards (matches existing style; F11 owns input
// validation — Wave-4 scope includes these exports).

import "C"

import (
	"errors"

	"github.com/BoldBitcoinWallet/BBMTLib/dkls"
	"github.com/BoldBitcoinWallet/BBMTLib/internal/keyhandles"
)

var errUnknownHandle = errors.New("unknown or expired keyshare handle")

//export BbmtImportBackupStaged
func BbmtImportBackupStaged(blob, password *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(dkls.ImportBackupStaged(mustGoStr(blob, "blob"), mustGoStr(password, "password")))
}

//export BbmtFinalizeStagedForPersist
func BbmtFinalizeStagedForPersist(handle, nsec, npub *C.char) (out *C.char) {
	defer recoverBridge(&out)
	return cString(dkls.FinalizeStagedForPersist(mustGoStr(handle, "handle"), mustGoStr(nsec, "nsec"), mustGoStr(npub, "npub")))
}

//export BbmtDestroyStaged
func BbmtDestroyStaged(handle *C.char) (out *C.char) {
	defer recoverBridge(&out)
	if !keyhandles.Destroy(mustGoStr(handle, "handle")) {
		return cString("", errUnknownHandle)
	}
	return cString("ok", nil)
}

//export BbmtDestroyAllStaged
func BbmtDestroyAllStaged() (out *C.char) {
	defer recoverBridge(&out)
	keyhandles.DestroyAll()
	return cString("ok", nil)
}

//export BbmtProjectMetadata
func BbmtProjectMetadata(fullJSON *C.char) (out *C.char) {
	defer recoverBridge(&out)
	raw, err := keyhandles.MetadataJSON([]byte(mustGoStr(fullJSON, "fullJSON")))
	if err != nil {
		return cString("", err)
	}
	return cString(string(raw), nil)
}

//export BbmtRedactedStructure
func BbmtRedactedStructure(fullJSON *C.char) (out *C.char) {
	defer recoverBridge(&out)
	raw, err := keyhandles.RedactedStructure([]byte(mustGoStr(fullJSON, "fullJSON")))
	if err != nil {
		return cString("", err)
	}
	return cString(string(raw), nil)
}
