// Package cstrwipe tracks C-string allocation lengths so the bridge can
// memset (not just free) buffers that carried secrets. Pure Go and
// unit-testable; the cgo calls stay in the bridge package.
package cstrwipe

import (
	"sync"
	"unsafe"
)

var lens sync.Map // map[unsafe.Pointer]int, byte length incl. NUL

// Track records the allocation length for p.
func Track(p unsafe.Pointer, n int) {
	if p == nil || n <= 0 {
		return
	}
	lens.Store(p, n)
}

// TakeLen removes and returns the recorded length for p.
func TakeLen(p unsafe.Pointer) (int, bool) {
	if p == nil {
		return 0, false
	}
	v, ok := lens.LoadAndDelete(p)
	if !ok {
		return 0, false
	}
	n, ok := v.(int)
	if !ok || n <= 0 {
		return 0, false
	}
	return n, true
}
