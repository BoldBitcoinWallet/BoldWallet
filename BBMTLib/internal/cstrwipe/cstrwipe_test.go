package cstrwipe

import (
	"testing"
	"unsafe"
)

func TestF15_WipeRegistry_TrackTake(t *testing.T) {
	var slotA, slotB int
	p, q := unsafe.Pointer(&slotA), unsafe.Pointer(&slotB)
	if _, ok := TakeLen(p); ok {
		t.Fatal("unknown pointer reported tracked")
	}
	Track(p, 17)
	n, ok := TakeLen(p)
	if !ok || n != 17 {
		t.Fatalf("take = %d,%v; want 17,true", n, ok)
	}
	if _, ok := TakeLen(p); ok {
		t.Fatal("double take reported tracked")
	}
	if _, ok := TakeLen(q); ok {
		t.Fatal("untracked neighbor reported tracked")
	}
}

func TestF15_WipeRegistry_NilSafe(t *testing.T) {
	Track(nil, 10)
	if _, ok := TakeLen(nil); ok {
		t.Fatal("nil pointer reported tracked")
	}
	var slot int
	Track(unsafe.Pointer(&slot), 0)
	if _, ok := TakeLen(unsafe.Pointer(&slot)); ok {
		t.Fatal("zero length reported tracked")
	}
}
