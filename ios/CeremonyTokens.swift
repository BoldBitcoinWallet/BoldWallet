import Foundation

// F15b-2 / F10-bridge ceremony-token core (3b-1). Pure Swift (no RN
// deps) so the ceremony-harness compiles this file standalone.
// Mirrors android CeremonyTokens.kt transition-for-transition:
// same states, same single-live-session rule, same fail-closed
// verify. The bridge layer (BBMTLibNativeModule) adds the
// OS-visible LAContext prompt + device-lock gate; NOTHING here
// mints without the caller having authenticated.
//
// State machine (terminal: used, expired, revoked):
//   minted → active    (first successful verify)
//   minted → expired   (timeout, enforced lazily at verify)
//   minted → revoked   (release / revokeSession / superseded)
//   active → used      (complete on ceremony success)
//   active → revoked   (release / revokeSession / superseded)
//   active → expired   (timeout)
// verify() on a terminal token returns false without transition.
// Failed verify (wrong op/session) returns false WITHOUT
// transitioning — probing must not kill a live token.
//
// Validation (executed HERE at the bridge, never trusted from JS):
//   exists && state ∈ {minted, active} && opClass match &&
//   sessionID match && (active || now ≤ expiresAt).
// TTL bounds ceremony START, not duration: an unstarted
// (minted) token past TTL fails and goes expired, but a
// started ceremony never dies mid-sign from token expiry
// (that would be a state-consistency bug). Duration is
// bounded by complete/release/cancel, single-live-session
// supersession, and process death (in-memory map).
// All failures return plain false — the bridge maps every
// failure to one CEREMONY_AUTH_REQUIRED (no reason oracle).
// Checks run pre-transition (flat single false); nothing
// transitions-then-rolls-back.

// NOTE: no transport case. Transport calls (fetchData/
// publishData) verify against the PARENT ceremony token
// (sign|keygen) + session — the ceremony's own channel needs
// no separate mint, and one token per ceremony removes a JS
// token-confusion failure mode. The strict rule stands for
// sign/export/import/config: never interchanged.
enum CeremonyOpClass: String {
  case sign
  case keygen
  case export
  case `import`
  case config

  static func parse(_ wire: String) -> CeremonyOpClass? {
    CeremonyOpClass(rawValue: wire)
  }
}

enum CeremonyTokenState {
  case minted
  case active
  case used
  case expired
  case revoked
}

struct CeremonyTokenRecord {
  var opClass: CeremonyOpClass
  var sessionID: String
  var expiresAtMs: Int64
  var state: CeremonyTokenState
  var useCount: Int
}

enum CeremonyTokens {
  static let ttlMs: Int64 = 10 * 60 * 1000

  private static var tokens: [String: CeremonyTokenRecord] = [:]
  private static let lock = NSLock()

  /// Injected for tests (fake clock / deterministic IDs).
  static var nowMs: () -> Int64 = {
    Int64(Date().timeIntervalSince1970 * 1000)
  }
  static var randomTokenId: () -> String = {
    (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
  }

  /// Mint after successful OS auth. Revokes superseded tokens.
  static func mint(opClass: CeremonyOpClass, sessionID: String) -> String {
    precondition(!sessionID.isEmpty, "sessionID required")
    lock.lock()
    defer { lock.unlock() }
    // Single live session: a new ceremony supersedes every
    // non-terminal token of any other session. Same-session
    // prior tokens (any class) are superseded too — newest
    // mint wins, so a stale issuance can never linger.
    for id in tokens.keys {
      if let rec = tokens[id], !isTerminal(rec.state) {
        tokens[id] = CeremonyTokenRecord(
          opClass: rec.opClass, sessionID: rec.sessionID,
          expiresAtMs: rec.expiresAtMs, state: .revoked,
          useCount: rec.useCount)
      }
    }
    var id = randomTokenId()
    while tokens[id] != nil {
      id = randomTokenId()
    }
    tokens[id] = CeremonyTokenRecord(
      opClass: opClass, sessionID: sessionID,
      expiresAtMs: nowMs() + ttlMs, state: .minted, useCount: 0)
    return id
  }

  /// Native-side authorization check. Call with the op class the
  /// NATIVE method requires — never a class supplied by JS.
  static func verify(token: String, opClass: CeremonyOpClass, sessionID: String) -> Bool {
    verifyInner(token: token, allowedClasses: [opClass], sessionID: sessionID)
  }

  /// 3b-2a: single-call ceremonies without an MPC session (sends,
  /// nostr). Enforces op-class + TTL-start + revocation; session
  /// equality is inapplicable (nothing to match). Call sites that
  /// HAVE a session must use verify(), not this.
  static func verifySingleCall(token: String, opClass: CeremonyOpClass) -> Bool {
    verifyInner(token: token, allowedClasses: [opClass], sessionID: nil)
  }

  /// 3b-2c B13/B14: LAN handshake transport rides the handshake
  /// ceremony token (keygen for setup, sign for send/sign) with
  /// strict session equality. No transport class exists — the
  /// handshake IS the ceremony, minted at initSession start.
  static func verifyTransport(token: String, sessionID: String) -> Bool {
    verifyInner(token: token, allowedClasses: [.sign, .keygen], sessionID: sessionID)
  }

  private static func verifyInner(token: String, allowedClasses: Set<CeremonyOpClass>, sessionID: String?) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard var rec = tokens[token] else { return false }
    if isTerminal(rec.state) { return false }
    // TTL bounds START: only unstarted tokens can expire.
    if rec.state == .minted && nowMs() > rec.expiresAtMs {
      rec.state = .expired
      tokens[token] = rec
      return false
    }
    if !allowedClasses.contains(rec.opClass) {
      return false
    }
    if let sessionID, rec.sessionID != sessionID {
      return false
    }
    rec.state = .active
    rec.useCount += 1
    tokens[token] = rec
    return true
  }

  /// Ceremony completed normally → used. Idempotent.
  static func complete(token: String) {
    lock.lock()
    defer { lock.unlock() }
    if var rec = tokens[token], !isTerminal(rec.state) {
      rec.state = .used
      tokens[token] = rec
    }
  }

  /// Tear down without completion → revoked. Idempotent.
  static func release(token: String) {
    lock.lock()
    defer { lock.unlock() }
    if var rec = tokens[token], !isTerminal(rec.state) {
      rec.state = .revoked
      tokens[token] = rec
    }
  }

  /// B19: cancel revokes every live token of the session.
  static func revokeSession(sessionID: String) {
    lock.lock()
    defer { lock.unlock() }
    for id in tokens.keys {
      if var rec = tokens[id], rec.sessionID == sessionID, !isTerminal(rec.state) {
        rec.state = .revoked
        tokens[id] = rec
      }
    }
  }

  static func stateOf(token: String) -> CeremonyTokenState? {
    lock.lock()
    defer { lock.unlock() }
    return tokens[token]?.state
  }

  static func useCountOf(token: String) -> Int {
    lock.lock()
    defer { lock.unlock() }
    return tokens[token]?.useCount ?? 0
  }

  private static func isTerminal(_ state: CeremonyTokenState) -> Bool {
    state == .used || state == .expired || state == .revoked
  }

  /// Test-only reset (wipes the store + restores real clock/IDs).
  static func resetForTest() {
    lock.lock()
    tokens.removeAll()
    lock.unlock()
    nowMs = { Int64(Date().timeIntervalSince1970 * 1000) }
    randomTokenId = {
      (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }
  }
}
