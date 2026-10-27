package tss

import (
	"encoding/json"
	"math/big"
	"strings"
	"testing"
)

func TestNormalizeQuotedBigIntJSON_unquotesForBigInt(t *testing.T) {
	huge := "26893305167438869507242425359767166369233987274303420242495511149696884729747841813548088012878879179233727698513499955254799757527173233003315689631672002477944423547352868608415250323378851109598652578430584596972217995497273980546130042500062474392804746924231727553543805931316537768243054357333659240921388524105744092824083299557201163365972824867187955735755208326115903020045984935482872354464336303027833354620273175336686744274522303756130307858314669065160507995227828297277841038050145113931647827799594924786229280415337149413311775209480301815155637134936477226536572919243427989850416493729714233150837"
	quoted := `{"ecdsa_local_data":{"Alpha":"` + huge + `"},"created_at":1710000000}`
	bare := NormalizeQuotedBigIntJSON(quoted)
	if strings.Contains(bare, `"`+huge+`"`) {
		t.Fatalf("still quoted after normalize")
	}
	if !strings.Contains(bare, `"Alpha":`+huge) {
		t.Fatalf("missing bare Alpha: %s", bare[:min(120, len(bare))])
	}

	var wrap struct {
		ECDSALocalData struct {
			Alpha *big.Int `json:"Alpha"`
		} `json:"ecdsa_local_data"`
	}
	if err := json.Unmarshal([]byte(quoted), &wrap); err == nil {
		t.Fatal("expected quoted form to fail *big.Int unmarshal")
	}
	if err := json.Unmarshal([]byte(bare), &wrap); err != nil {
		t.Fatalf("bare form should unmarshal: %v", err)
	}
	if wrap.ECDSALocalData.Alpha.String() != huge {
		t.Fatalf("digit mismatch")
	}
}

func TestNormalizeQuotedBigIntJSON_noopWhenAlreadyBare(t *testing.T) {
	raw := `{"Alpha":123456789012345678901,"x":"ok"}`
	if got := NormalizeQuotedBigIntJSON(raw); got != raw {
		t.Fatalf("changed bare input: %q", got)
	}
}

func TestDetectQuotedBigIntJSONIssue_fixableVsUnrecoverable(t *testing.T) {
	quoted := `{"ecdsa_local_data":{"Alpha":"` + strings.Repeat("9", 40) + `"}}`
	if got := DetectQuotedBigIntJSONIssue(quoted); got != BigIntIssueQuoted {
		t.Fatalf("quoted: got %s", got)
	}
	sci := `{"ecdsa_local_data":{"Alpha":1.43042430941967e+308}}`
	if got := DetectQuotedBigIntJSONIssue(sci); got != BigIntIssueSci {
		t.Fatalf("sci: got %s", got)
	}
	bare := `{"ecdsa_local_data":{"Alpha":` + strings.Repeat("9", 40) + `}}`
	if got := DetectQuotedBigIntJSONIssue(bare); got != BigIntIssueNone {
		t.Fatalf("bare: got %s", got)
	}
	if got := DetectQuotedBigIntJSONIssue(NormalizeQuotedBigIntJSON(quoted)); got != BigIntIssueNone {
		t.Fatalf("after normalize: got %s", got)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
