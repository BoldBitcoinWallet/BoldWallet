package main

/*
#include <stdlib.h>
#include <string.h>
*/
import "C"
import (
	"unsafe"

	"github.com/BoldBitcoinWallet/BBMTLib/internal/cstrwipe"
)

// F15: cString records len+1 (NUL) per pointer so BbmtFree can memset the
// full allocation instead of freeing without wiping. Pointers missing from
// the registry (double-free, foreign) fall back to plain free.
func cString(result string, err error) *C.char {
	if err != nil {
		return trackCString("error:" + err.Error())
	}
	return trackCString(result)
}

func trackCString(s string) *C.char {
	p := C.CString(s)
	cstrwipe.Track(unsafe.Pointer(p), len(s)+1)
	return p
}

// wipeCString zeroes a tracked allocation. Split from BbmtFree for clarity;
// the registry itself is unit-tested in internal/cstrwipe.
func wipeCString(p *C.char) bool {
	if p == nil {
		return false
	}
	n, ok := cstrwipe.TakeLen(unsafe.Pointer(p))
	if !ok {
		return false
	}
	C.memset(unsafe.Pointer(p), 0, C.size_t(n))
	return true
}

//export BbmtFree
func BbmtFree(p *C.char) {
	if p == nil {
		return
	}
	wipeCString(p)
	C.free(unsafe.Pointer(p))
}
