package tss

import "testing"

func TestDescriptorChecksumKnownVectors(t *testing.T) {
	tests := []struct {
		desc string
		want string
	}{
		// Sparrow-compatible multipath descriptor (Bitcoin Core descsum_create).
		{
			"wpkh([00000000/44h/1h/0h]tpubDC2Q4xJvBca45p45NShqg3brHUNdCRmcEJX1SjzfNMA6HUqBmk7F62dqkUww3VXeHrPGR7e3Eq77Zz1R1Nz5aUU6iaeCw2M8L87muQigLLg/<0;1>/*)",
			"rgqjtjn0",
		},
	}
	for _, tc := range tests {
		got, err := DescriptorChecksum(tc.desc)
		if err != nil {
			t.Fatalf("DescriptorChecksum(%q): %v", tc.desc, err)
		}
		if got != tc.want {
			t.Fatalf("DescriptorChecksum(%q) = %q, want %q", tc.desc, got, tc.want)
		}
		withHash, err := AddDescriptorChecksum(tc.desc)
		if err != nil {
			t.Fatalf("AddDescriptorChecksum: %v", err)
		}
		if withHash != tc.desc+"#"+tc.want {
			t.Fatalf("AddDescriptorChecksum = %q", withHash)
		}
	}
}

func TestDescriptorChecksumBoldStylePath(t *testing.T) {
	body := "wpkh([a1b2c3d4/84'/1'/0']tpub6ExampleKeyDataGoesHereForTestingPurposesOnly123456789/0/*)"
	checksum, err := DescriptorChecksum(body)
	if err != nil {
		t.Fatal(err)
	}
	if len(checksum) != 8 {
		t.Fatalf("checksum length %d", len(checksum))
	}
	with, err := AddDescriptorChecksum(body)
	if err != nil {
		t.Fatal(err)
	}
	if with != body+"#"+checksum {
		t.Fatalf("AddDescriptorChecksum mismatch")
	}
}

func TestAddDescriptorChecksumReplacesExisting(t *testing.T) {
	body := "wpkh(02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9)"
	withWrong := body + "#00000000"
	got, err := AddDescriptorChecksum(withWrong)
	if err != nil {
		t.Fatal(err)
	}
	want, err := AddDescriptorChecksum(body)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
