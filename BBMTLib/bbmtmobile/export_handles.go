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
func BbmtImportBackupStaged(blob, password *C.char) *C.char {
	return cString(dkls.ImportBackupStaged(C.GoString(blob), C.GoString(password)))
}

//export BbmtFinalizeStagedForPersist
func BbmtFinalizeStagedForPersist(handle, nsec, npub *C.char) *C.char {
	return cString(dkls.FinalizeStagedForPersist(C.GoString(handle), C.GoString(nsec), C.GoString(npub)))
}

//export BbmtDestroyStaged
func BbmtDestroyStaged(handle *C.char) *C.char {
	if !keyhandles.Destroy(C.GoString(handle)) {
		return cString("", errUnknownHandle)
	}
	return cString("ok", nil)
}

//export BbmtDestroyAllStaged
func BbmtDestroyAllStaged() *C.char {
	keyhandles.DestroyAll()
	return cString("ok", nil)
}

//export BbmtProjectMetadata
func BbmtProjectMetadata(fullJSON *C.char) *C.char {
	raw, err := keyhandles.MetadataJSON([]byte(C.GoString(fullJSON)))
	if err != nil {
		return cString("", err)
	}
	return cString(string(raw), nil)
}

//export BbmtRedactedStructure
func BbmtRedactedStructure(fullJSON *C.char) *C.char {
	raw, err := keyhandles.RedactedStructure([]byte(C.GoString(fullJSON)))
	if err != nil {
		return cString("", err)
	}
	return cString(string(raw), nil)
}
