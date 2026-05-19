# DKLs23 security checklist

- [ ] `dkls-test-all.sh` green in CI before enabling `enable_dkls23` for users
- [ ] libtss-ffi built from audited tag; track [libtss spec/10-testing.md](../../libtss/spec/10-testing.md)
- [ ] Keyshares never passed through JS for signing (native encrypted storage only)
- [ ] `tss.Init(OptMlock)` on supported hosts where CAP_IPC_LOCK is available
- [ ] Zero keyshare UTF-8 buffers in Kotlin/Swift after use (reuse existing BBMTLib helpers)
- [ ] No in-place GG18 → DKLs23 migration — new keygen only
- [ ] Recovery CLI documented in [RECOVER.md](../RECOVER.md#dkls23-libtss)
