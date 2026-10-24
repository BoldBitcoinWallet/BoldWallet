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
