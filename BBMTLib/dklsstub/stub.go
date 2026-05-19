// Package dklsstub is gomobile-bindable (no cgo). Mobile uses JNI + libdklsmobile for real DKLs23 crypto.
package dklsstub

// HelloDkg returns a stub message on mobile; desktop builds use stub_desktop.go.
func HelloDkg() string {
	return "DKLS: link libdklsmobile (see BBMTLib/build-dkls.sh) or use dklsHelloDkg JNI"
}
