package main

/*
#include <stdlib.h>
typedef void (*bbmt_hook_fn)(const char *msg);
static void bbmt_invoke_hook(bbmt_hook_fn fn, const char *msg) {
  if (fn != NULL && msg != NULL) { fn(msg); }
}
*/
import "C"

import (
	"sync"
	"unsafe"

	"github.com/BoldBitcoinWallet/BBMTLib/tss"
)

var (
	hookMu     sync.RWMutex
	hookFn     C.bbmt_hook_fn
	goLogMu    sync.RWMutex
	goLogFn    C.bbmt_hook_fn
)

type bridgeHookListener struct{}

func (bridgeHookListener) OnMessage(message string) {
	hookMu.RLock()
	fn := hookFn
	hookMu.RUnlock()
	if fn == nil {
		return
	}
	cmsg := C.CString(message)
	C.bbmt_invoke_hook(fn, cmsg)
	C.free(unsafe.Pointer(cmsg))
}

type bridgeGoLogListener struct{}

func (bridgeGoLogListener) OnGoLog(message string) {
	goLogMu.RLock()
	fn := goLogFn
	goLogMu.RUnlock()
	if fn == nil {
		return
	}
	cmsg := C.CString(message)
	C.bbmt_invoke_hook(fn, cmsg)
	C.free(unsafe.Pointer(cmsg))
}

//export BbmtSetHookListener
func BbmtSetHookListener(fn C.bbmt_hook_fn) {
	hookMu.Lock()
	hookFn = fn
	if fn != nil {
		tss.SetHookListener(bridgeHookListener{})
	} else {
		tss.SetHookListener(nil)
	}
	hookMu.Unlock()
}

//export BbmtSetGoLogListener
func BbmtSetGoLogListener(fn C.bbmt_hook_fn) {
	goLogMu.Lock()
	goLogFn = fn
	if fn != nil {
		tss.SetEventListener(bridgeGoLogListener{})
	} else {
		tss.SetEventListener(nil)
	}
	goLogMu.Unlock()
}
