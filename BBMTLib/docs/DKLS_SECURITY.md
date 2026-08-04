# DKLs23 security checklist

- [ ] `dkls-test-all.sh` green in CI before enabling `enable_dkls23` for users
- [ ] libtss-ffi built from audited tag; track [libtss spec/10-testing.md](../../libtss/spec/10-testing.md)
- [ ] Keyshares never passed through JS for signing (native encrypted storage only)
- [ ] Attempt `tss.Init(OptMlock)` and fallback to `tss.Init()` when CAP_IPC_LOCK/permissions are unavailable (log fallback once)
- [ ] Zero keyshare UTF-8 buffers in Kotlin/Swift after use (reuse existing BBMTLib helpers)
- [ ] No in-place GG18 → DKLs23 migration — new keygen only
- [ ] Recovery CLI documented in [RECOVER.md](../RECOVER.md#dkls23-libtss)
- [ ] Operator runbook documented in [SELF_CUSTODY_OPERATIONS.md](./SELF_CUSTODY_OPERATIONS.md)
- [x] RNG: production paths use OS CSPRNG; see [RNG_AUDIT_COLDCARD_2026.md](./RNG_AUDIT_COLDCARD_2026.md)
- [x] Release gate / libtss CI assert `insecure-rng` is not enabled for production builds
