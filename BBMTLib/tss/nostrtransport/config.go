package nostrtransport

import "time"

// Config defines the runtime parameters required to run a Nostr-backed MPC session.
type Config struct {
	Relays         []string
	SessionID      string
	SessionKeyHex  string
	LocalNpub      string
	LocalNsec      string
	PeersNpub      []string
	ChunkSize      int
	ChunkTTL       time.Duration
	MaxTimeout     time.Duration
	ConnectTimeout time.Duration
}

func (c *Config) ApplyDefaults() {
	if c.ChunkSize == 0 {
		c.ChunkSize = 16 * 1024
	}
	if c.ChunkTTL == 0 {
		c.ChunkTTL = 2 * time.Minute
	}
	if c.MaxTimeout == 0 {
		c.MaxTimeout = 90 * time.Second
	}
	if c.ConnectTimeout == 0 {
		c.ConnectTimeout = 20 * time.Second
	}
}

func (c *Config) Validate() error {
	if len(c.Relays) == 0 {
		return ErrInvalidConfig("relays are required")
	}
	if c.SessionID == "" {
		return ErrInvalidConfig("session id is required")
	}
	if c.SessionKeyHex == "" {
		return ErrInvalidConfig("session key is required")
	}
	if c.LocalNpub == "" || c.LocalNsec == "" {
		return ErrInvalidConfig("local npub/nsec are required")
	}
	if len(c.PeersNpub) == 0 {
		return ErrInvalidConfig("peer npubs are required")
	}
	return nil
}

// ErrInvalidConfig is returned when mandatory fields are missing.
type ErrInvalidConfig string

func (e ErrInvalidConfig) Error() string { return string(e) }
