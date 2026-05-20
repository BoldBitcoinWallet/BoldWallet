package tss

import (
	"fmt"
	"strings"
)

// Output descriptor checksum (BIP 380 / Bitcoin Core descriptor.cpp).

const descriptorInputCharset = "0123456789()[],'/*abcdefgh@:$%{}" +
	"IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~" +
	"ijklmnopqrstuvwxyzABCDEFGH`#\"\\ "
const descriptorChecksumCharset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

var descriptorGenerator = [5]uint64{0xf5dee51989, 0xa9fdca3312, 0x1bab10e32d, 0x3706b1677a, 0x644d626ffd}

func descriptorPolyMod(c uint64, val int) uint64 {
	c0 := byte(c >> 35)
	c = ((c & 0x7ffffffff) << 5) ^ uint64(val)
	if c0&1 != 0 {
		c ^= descriptorGenerator[0]
	}
	if c0&2 != 0 {
		c ^= descriptorGenerator[1]
	}
	if c0&4 != 0 {
		c ^= descriptorGenerator[2]
	}
	if c0&8 != 0 {
		c ^= descriptorGenerator[3]
	}
	if c0&16 != 0 {
		c ^= descriptorGenerator[4]
	}
	return c
}

func descriptorExpandSymbols(desc string) ([]int, error) {
	symbols := make([]int, 0, len(desc)+3)
	cls := 0
	clsCount := 0
	for _, ch := range desc {
		pos := strings.IndexRune(descriptorInputCharset, ch)
		if pos < 0 {
			return nil, fmt.Errorf("invalid descriptor character %q", ch)
		}
		symbols = append(symbols, pos&31)
		cls = cls*3 + (pos >> 5)
		clsCount++
		if clsCount == 3 {
			symbols = append(symbols, cls)
			cls = 0
			clsCount = 0
		}
	}
	if clsCount > 0 {
		symbols = append(symbols, cls)
	}
	return symbols, nil
}

// DescriptorChecksum returns the 8-character checksum for a descriptor body (no # suffix).
func DescriptorChecksum(desc string) (string, error) {
	symbols, err := descriptorExpandSymbols(desc)
	if err != nil {
		return "", err
	}
	c := uint64(1)
	for _, sym := range symbols {
		c = descriptorPolyMod(c, sym)
	}
	for i := 0; i < 8; i++ {
		c = descriptorPolyMod(c, 0)
	}
	c ^= 1
	out := make([]byte, 8)
	for j := 0; j < 8; j++ {
		out[j] = descriptorChecksumCharset[(c>>(5*(7-j)))&31]
	}
	return string(out), nil
}

// AppendOutputDescriptorChecksum appends Sparrow-style #checksum (gomobile / Android Tss API).
func AppendOutputDescriptorChecksum(desc string) (string, error) {
	return AddDescriptorChecksum(desc)
}

// AddDescriptorChecksum appends #CHECKSUM to a descriptor body.
func AddDescriptorChecksum(desc string) (string, error) {
	if desc == "" {
		return "", nil
	}
	body := desc
	if i := strings.LastIndex(desc, "#"); i >= 0 {
		body = desc[:i]
	}
	checksum, err := DescriptorChecksum(body)
	if err != nil {
		return "", err
	}
	return body + "#" + checksum, nil
}
