package nostrtransport

import (
	"testing"
)

// F14 Part A: SessionKeyHex (required-but-never-read) is removed from Config.
// A fully-populated config without any session key must validate; every
// remaining required check must still fire.

func f14BaseConfig() Config {
	return Config{
		Relays:    []string{"wss://relay.example"},
		SessionID: "sess",
		LocalNpub: "npub1test",
		LocalNsec: "nsec1test",
		PeersNpub: []string{"npub1peer"},
	}
}

func TestF14_NoSessionKeyRequired(t *testing.T) {
	cfg := f14BaseConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("config without session key must validate: %v", err)
	}
}

func TestF14_OtherChecksIntact(t *testing.T) {
	cases := []struct {
		name  string
		blank func(*Config)
	}{
		{"relays", func(c *Config) { c.Relays = nil }},
		{"sessionID", func(c *Config) { c.SessionID = "" }},
		{"localNpub", func(c *Config) { c.LocalNpub = "" }},
		{"localNsec", func(c *Config) { c.LocalNsec = "" }},
		{"peersNpub", func(c *Config) { c.PeersNpub = nil }},
	}
	for _, tc := range cases {
		cfg := f14BaseConfig()
		tc.blank(&cfg)
		if err := cfg.Validate(); err == nil {
			t.Fatalf("blank %s must fail validation", tc.name)
		}
	}
}
