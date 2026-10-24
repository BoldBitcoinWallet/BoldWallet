// F15b-2 ceremony-token harness: compiles the ACTUAL
// ios/CeremonyTokens.swift (no RN deps) and exercises the state
// machine, class/session binding, expiry, and revocation with a
// fake clock. Mirrors CeremonyTokensTest.kt case-for-case.
import Foundation

var failures = 0
func check(_ cond: Bool, _ msg: String) {
  if cond { print("ok: \(msg)") } else { print("FAIL: \(msg)"); failures += 1 }
}

var now: Int64 = 1_700_000_000_000
var counter = 0
func reset() {
  CeremonyTokens.resetForTest()
  CeremonyTokens.nowMs = { now }
  CeremonyTokens.randomTokenId = {
    counter += 1
    return String(format: "tok%028d", counter)
  }
}

// Mint → verify activates, multi-use stays active.
reset()
var t = CeremonyTokens.mint(opClass: .sign, sessionID: "s1")
check(CeremonyTokens.stateOf(token: t) == .minted, "mint starts minted")
check(CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s1"), "verify passes")
check(CeremonyTokens.stateOf(token: t) == .active, "verify activates")
check(CeremonyTokens.useCountOf(token: t) == 1, "use counted")
check(CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s1"), "multi-use passes")
check(CeremonyTokens.stateOf(token: t) == .active, "multi-use stays active")

// Class binding: no cross-replay; failure doesn't transition.
reset()
t = CeremonyTokens.mint(opClass: .sign, sessionID: "s1")
check(!CeremonyTokens.verify(token: t, opClass: .export, sessionID: "s1"), "cross-class fails")
check(!CeremonyTokens.verify(token: t, opClass: .keygen, sessionID: "s1"), "cross-class fails 2")
check(CeremonyTokens.stateOf(token: t) == .minted, "failed verify keeps minted")
check(CeremonyTokens.useCountOf(token: t) == 0, "failed verify uncounted")
check(CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s1"), "right class works after")

// Session binding.
reset()
t = CeremonyTokens.mint(opClass: .sign, sessionID: "s1")
check(!CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s2"), "wrong session fails")
check(CeremonyTokens.stateOf(token: t) == .minted, "wrong session keeps minted")
check(CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s1"), "right session works")

// Unknown token.
reset()
check(!CeremonyTokens.verify(token: "tok0000000000000000000000000099", opClass: .sign, sessionID: "s1"), "unknown fails")
check(CeremonyTokens.stateOf(token: "nope") == nil, "unknown has no state")

// Expiry lazily terminal (unstarted tokens only).
reset()
t = CeremonyTokens.mint(opClass: .sign, sessionID: "s1")
now += CeremonyTokens.ttlMs + 1
check(!CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s1"), "unstarted expired fails")
check(CeremonyTokens.stateOf(token: t) == .expired, "expiry terminal")
check(!CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s1"), "expired stays failed")
now -= CeremonyTokens.ttlMs + 1

// TTL bounds start, not duration.
reset()
t = CeremonyTokens.mint(opClass: .sign, sessionID: "s1")
check(CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s1"), "start passes")
now += CeremonyTokens.ttlMs + 1
check(CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s1"), "active survives past TTL")
check(CeremonyTokens.stateOf(token: t) == .active, "stays active")
check(!CeremonyTokens.verify(token: t, opClass: .export, sessionID: "s1"), "class still bound when active")
check(!CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s2"), "session still bound when active")
CeremonyTokens.complete(token: t)
check(!CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s1"), "complete still retires")
now -= CeremonyTokens.ttlMs + 1

// Complete retires to used, idempotent.
reset()
t = CeremonyTokens.mint(opClass: .sign, sessionID: "s1")
check(CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s1"), "pre-complete passes")
CeremonyTokens.complete(token: t)
check(CeremonyTokens.stateOf(token: t) == .used, "complete retires to used")
check(!CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s1"), "used fails verify")
CeremonyTokens.complete(token: t)
check(CeremonyTokens.stateOf(token: t) == .used, "complete idempotent")

// Release revokes, idempotent.
reset()
t = CeremonyTokens.mint(opClass: .sign, sessionID: "s1")
CeremonyTokens.release(token: t)
check(CeremonyTokens.stateOf(token: t) == .revoked, "release revokes")
check(!CeremonyTokens.verify(token: t, opClass: .sign, sessionID: "s1"), "revoked fails verify")
CeremonyTokens.release(token: t)
check(CeremonyTokens.stateOf(token: t) == .revoked, "release idempotent")

// Cancel revokes session; new ceremony start supersedes.
reset()
let a = CeremonyTokens.mint(opClass: .sign, sessionID: "sA")
let b = CeremonyTokens.mint(opClass: .sign, sessionID: "sB")
check(CeremonyTokens.stateOf(token: a) == .revoked, "new ceremony revokes prior session")
check(CeremonyTokens.stateOf(token: b) == .minted, "new ceremony minted")
CeremonyTokens.revokeSession(sessionID: "sB")
check(CeremonyTokens.stateOf(token: b) == .revoked, "cancel revokes session")
check(!CeremonyTokens.verify(token: b, opClass: .sign, sessionID: "sB"), "cancelled fails verify")

// Same-session remint supersedes.
reset()
let first = CeremonyTokens.mint(opClass: .config, sessionID: "s1")
let second = CeremonyTokens.mint(opClass: .config, sessionID: "s1")
check(CeremonyTokens.stateOf(token: first) == .revoked, "remint revokes first")
check(CeremonyTokens.verify(token: second, opClass: .config, sessionID: "s1"), "remint verifies")
check(!CeremonyTokens.verify(token: first, opClass: .config, sessionID: "s1"), "first stays failed")

// 3b-2a: single-call verify (session-less ceremonies).
reset()
let sc = CeremonyTokens.mint(opClass: .sign, sessionID: "nostr-single-call")
check(CeremonyTokens.verifySingleCall(token: sc, opClass: .sign), "single-call accepts right class")
check(CeremonyTokens.stateOf(token: sc) == .active, "single-call activates")
reset()
let scw = CeremonyTokens.mint(opClass: .sign, sessionID: "s1")
check(!CeremonyTokens.verifySingleCall(token: scw, opClass: .export), "single-call rejects wrong class")
check(!CeremonyTokens.verifySingleCall(token: scw, opClass: .keygen), "single-call rejects wrong class 2")
check(CeremonyTokens.stateOf(token: scw) == .minted, "single-call failure keeps minted")
check(!CeremonyTokens.verifySingleCall(token: "tok0000000000000000000000000099", opClass: .sign), "single-call rejects unknown")
CeremonyTokens.release(token: scw)
check(!CeremonyTokens.verifySingleCall(token: scw, opClass: .sign), "single-call rejects revoked")
let sce = CeremonyTokens.mint(opClass: .sign, sessionID: "s9")
now += CeremonyTokens.ttlMs + 1
check(!CeremonyTokens.verifySingleCall(token: sce, opClass: .sign), "single-call rejects expired")
check(CeremonyTokens.stateOf(token: sce) == .expired, "single-call expiry terminal")
// 3b-2b B20/B21: keypair generators mint keygen, verify keygen.
reset()
let kg = CeremonyTokens.mint(opClass: .keygen, sessionID: "pairing-1")
check(CeremonyTokens.verifySingleCall(token: kg, opClass: .keygen), "single-call keygen round-trip")
check(!CeremonyTokens.verifySingleCall(token: kg, opClass: .sign), "single-call keygen not sign")
// 3b-2c B13/B14: transport rides sign|keygen + strict session.
reset()
let ts = CeremonyTokens.mint(opClass: .sign, sessionID: "hs-1")
check(CeremonyTokens.verifyTransport(token: ts, sessionID: "hs-1"), "transport accepts sign")
let tk = CeremonyTokens.mint(opClass: .keygen, sessionID: "hs-2")
check(CeremonyTokens.verifyTransport(token: tk, sessionID: "hs-2"), "transport accepts keygen")
check(CeremonyTokens.verifyTransport(token: tk, sessionID: "hs-2"), "transport multi-use (poll loop)")
check(CeremonyTokens.stateOf(token: tk) == .active, "transport poll stays active")
let te = CeremonyTokens.mint(opClass: .export, sessionID: "hs-1")
check(!CeremonyTokens.verifyTransport(token: te, sessionID: "hs-1"), "transport rejects export")
let tc = CeremonyTokens.mint(opClass: .config, sessionID: "hs-1")
check(!CeremonyTokens.verifyTransport(token: tc, sessionID: "hs-1"), "transport rejects config")
let ti = CeremonyTokens.mint(opClass: .import, sessionID: "hs-1")
check(!CeremonyTokens.verifyTransport(token: ti, sessionID: "hs-1"), "transport rejects import")
let tm = CeremonyTokens.mint(opClass: .sign, sessionID: "hs-1")
check(!CeremonyTokens.verifyTransport(token: tm, sessionID: "hs-2"), "transport rejects wrong session")
check(!CeremonyTokens.verifyTransport(token: "tok0000000000000000000000000099", sessionID: "hs-1"), "transport rejects unknown")
CeremonyTokens.release(token: tm)
check(!CeremonyTokens.verifyTransport(token: tm, sessionID: "hs-1"), "transport rejects revoked")

// Wire parsing strict.
check(CeremonyOpClass.parse("sign") == .sign, "parse sign")
check(CeremonyOpClass.parse("keygen") == .keygen, "parse keygen")
check(CeremonyOpClass.parse("Sign") == nil, "parse rejects case")
check(CeremonyOpClass.parse("admin") == nil, "parse rejects unknown")
check(CeremonyOpClass.parse("") == nil, "parse rejects empty")
check(CeremonyOpClass.parse("transport") == nil, "no transport class (rides parent)")

if failures == 0 {
  print("CEREMONY HARNESS PASSED")
} else {
  print("CEREMONY HARNESS FAILED (\(failures))")
}
exit(failures == 0 ? 0 : 1)
