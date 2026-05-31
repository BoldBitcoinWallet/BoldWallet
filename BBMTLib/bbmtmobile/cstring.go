package main

/*
#include <stdlib.h>
*/
import "C"
import "unsafe"

func cString(result string, err error) *C.char {
	if err != nil {
		return C.CString("error:" + err.Error())
	}
	return C.CString(result)
}

//export BbmtFree
func BbmtFree(p *C.char) {
	if p != nil {
		C.free(unsafe.Pointer(p))
	}
}
