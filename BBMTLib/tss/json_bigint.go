package tss

import (
	"regexp"
	"strings"
)

// Issue codes for GG18 *big.Int JSON corruption (detectable / fixable).
const (
	BigIntIssueNone    = "none"
	BigIntIssueQuoted  = "quoted_oversized_ints" // fixable
	BigIntIssueSci     = "scientific_float"      // unrecoverable
	BigIntIssueNotGG18 = "not_gg18"
	BigIntIssueEmpty   = "empty"
)

// oversizedQuotedIntRE matches JSON string values that are pure decimal
// integers with more than 16 digits — the form left by a JS
// quote→parse→stringify round-trip of Go *big.Int fields.
//
// Go's math/big.Int UnmarshalJSON only accepts bare number tokens (or
// null), so those quoted strings fail with:
//
//	cannot unmarshal "\"123…\"" into a *big.Int
//
// Re-emitting bare numbers restores the original Go marshal shape
// without changing digit content (unlike IEEE float corruption).
var (
	oversizedQuotedIntRE = regexp.MustCompile(`([:\[,]\s*)"(-?\d{17,})"`)
	scientificFloatRE    = regexp.MustCompile(`\d+\.\d+[eE][+\-]?\d+`)
)

// DetectQuotedBigIntJSONIssue classifies GG18 keyshare JSON corruption.
// quoted_oversized_ints is fixable via NormalizeQuotedBigIntJSON;
// scientific_float is not (precision already lost).
func DetectQuotedBigIntJSONIssue(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return BigIntIssueEmpty
	}
	if !strings.Contains(raw, "ecdsa_local_data") {
		return BigIntIssueNotGG18
	}
	if scientificFloatRE.MatchString(raw) || strings.Contains(raw, "Infinity") {
		return BigIntIssueSci
	}
	if oversizedQuotedIntRE.MatchString(raw) {
		return BigIntIssueQuoted
	}
	return BigIntIssueNone
}

// NormalizeQuotedBigIntJSON converts oversized quoted decimal strings
// back to bare JSON number tokens so *big.Int can unmarshal them.
func NormalizeQuotedBigIntJSON(raw string) string {
	if DetectQuotedBigIntJSONIssue(raw) != BigIntIssueQuoted {
		return raw
	}
	return oversizedQuotedIntRE.ReplaceAllString(raw, `${1}${2}`)
}
