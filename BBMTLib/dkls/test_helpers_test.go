package dkls

import "testing"

func skipIntegrationIfShort(t *testing.T, reason string) {
	t.Helper()
	if testing.Short() {
		t.Skip(reason)
	}
}
