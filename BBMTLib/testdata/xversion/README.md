# Cross-version fixtures (v4.1.0 → v4.1.1)

Generated 2026-10-25 by the **v4.1.0 tree** (tag `v4.1.0`, `92362c6b`)
running its own `RunDKGInProcess`, `AesEncrypt`, `EciesEncrypt`,
`DeriveLANSessionKey`. All keys are test-only.

Consumed by:
- `BBMTLib/tss/xversion_fixture_test.go` (trio chunk, `h1:` tag, ECIES
  chunk, legacy CBC backup import)
- `BBMTLib/dkls/xversion_fixture_test.go` (share import under F2 binding
  + full sign + ECDSA verify)

Reverse direction (current-code chunks decrypted by v4.1.0 code) was
verified with the symmetric temporary tests during Wave 6 Phase 0 and
passed; only the forward direction is kept as a regression suite.

Regenerate: check out `tags/v4.1.0` in a worktree, re-add the temporary
generator tests from git history of this directory's introduction commit,
run `go test -run TestXVersionGenFixtures ./dkls/ ./tss/`.
