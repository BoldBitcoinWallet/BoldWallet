package tss

import "testing"

func TestIsDKLsKeyshareJSON(t *testing.T) {
	tests := []struct {
		name string
		json string
		want bool
	}{
		{
			name: "explicit dkls23",
			json: `{"tss_backend":"dkls23","share_b64":"abc"}`,
			want: true,
		},
		{
			name: "explicit gg18",
			json: `{"tss_backend":"gg18","share_b64":"abc"}`,
			want: false,
		},
		{
			name: "share_b64 only",
			json: `{"share_b64":"abc"}`,
			want: true,
		},
		{
			name: "ecdsa_local_data prefers gg18",
			json: `{"ecdsa_local_data":{"x":1},"share_b64":"abc"}`,
			want: false,
		},
		{
			name: "empty",
			json: `{}`,
			want: false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := IsDKLsKeyshareJSON(tc.json)
			if got != tc.want {
				t.Fatalf("IsDKLsKeyshareJSON() = %v, want %v", got, tc.want)
			}
		})
	}
}
