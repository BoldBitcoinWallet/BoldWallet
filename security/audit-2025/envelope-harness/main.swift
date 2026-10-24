// F15b-1 envelope harness: compiles the ACTUAL ios/KeyshareEnvelope.swift
// (no RN deps) and exercises seal/open/keychain/migration on macOS.
// Uses throwaway keychain accounts; cleans up after itself.
import CryptoKit
import Foundation
import Security

var failures = 0
func check(_ cond: Bool, _ msg: String) {
  if cond { print("ok: \(msg)") } else { print("FAIL: \(msg)"); failures += 1 }
}

let testKey = "f15b1-test-envelope-key"
let plain = "{\"pub_key\":\"03aa\",\"share_b64\":\"F15B1-HARNESS-SECRET\"}"

do {
  // Round-trip + opacity.
  let env = try KeyshareEnvelope.encrypt(plain, keyAccount: testKey)
  check(KeyshareEnvelope.isEnvelope(env), "seal produces v1 envelope")
  check(!env.contains("F15B1-HARNESS-SECRET"), "envelope hides plaintext")
  check(try KeyshareEnvelope.decrypt(env, keyAccount: testKey) == plain, "open round-trips")
  let env2 = try KeyshareEnvelope.encrypt(plain, keyAccount: testKey)
  check(env != env2, "fresh nonce per seal")
  check(
    (try KeyshareEnvelope.decrypt(env2, keyAccount: testKey)) == plain, "second seal opens")

  // Tamper fails closed.
  let parts = env.split(separator: ":").map(String.init)
  let badCt = String(parts[2].dropLast(2)) + (parts[2].hasSuffix("AA") ? "BB" : "AA")
  do {
    _ = try KeyshareEnvelope.decrypt("\(parts[0]):\(parts[1]):\(badCt)", keyAccount: testKey)
    check(false, "tampered envelope rejected")
  } catch { check(true, "tampered envelope rejected") }

  // Malformed fails closed (incl. short-ct crash guard).
  // NOTE: isEnvelope is shape-only (marker + 3 parts); the short-ct
  // vector passes shape but must fail decrypt (rest.count > 16).
  for bad in ["", "v1:", "v1:onlytwo", "v2:a:b", "v1:::", "{\"pub_key\":\"x\"}"] {
    check(!KeyshareEnvelope.isEnvelope(bad), "isEnvelope(\(bad.prefix(12))…) false")
  }
  for bad in ["", "v1:", "v1:onlytwo", "v2:a:b", "v1:::", "{\"pub_key\":\"x\"}",
    "v1:AAAAAAAAAAAAAAAA:AA==", "v1:AAAAAAAAAAAAAAAA:AA==".replacingOccurrences(of: "A", with: "!")] {
    do {
      _ = try KeyshareEnvelope.decrypt(bad, keyAccount: testKey)
      check(false, "malformed rejected: \(bad.prefix(12))")
    } catch { check(true, "malformed rejected: \(bad.prefix(12))") }
  }

  // Resolve tripwire.
  check(KeyshareEnvelope.containsShareSecrets("{\"share_b64\":\"eA==\"}"), "tripwire share_b64")
  check(
    KeyshareEnvelope.containsShareSecrets("{\"ecdsa_local_data\":{}}"), "tripwire ecdsa")
  check(KeyshareEnvelope.containsShareSecrets("{\"nsec\":\"x\"}"), "tripwire nsec")
  check(
    !KeyshareEnvelope.containsShareSecrets(
      "{\"handle\":\"ab12\",\"metadata\":{\"pub_key\":\"03aa\",\"nostr_npub\":\"npub1x\"}}"),
    "tripwire clean on metadata")

  // Store-query carries the F4 protection class (no drift vs .m patch).
  let q = KeyshareEnvelope.storeQueryForKey(account: "keyshare", data: Data("x".utf8))
  check(
    (q[kSecAttrAccessible as String] as! CFString) == kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
    "store query has WhenPasscodeSetThisDeviceOnly")

  // Migration converge + idempotent re-run on throwaway accounts.
  let acct = "f15b1-test-keyshare"
  try KeyshareEnvelope.deleteItem(account: acct)
  try KeyshareEnvelope.deleteItem(account: acct + "_migrating")
  try KeyshareEnvelope.addItem(
    account: acct, data: Data(plain.utf8),
    accessible: kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly)
  check(
    try KeyshareEnvelope.ensureEnveloped(account: acct, keyAccount: testKey),
    "migration ran on plaintext")
  let after = try KeyshareEnvelope.readItem(account: acct).flatMap {
    String(data: $0, encoding: .utf8)
  }!
  check(KeyshareEnvelope.isEnvelope(after), "stored value is envelope")
  check(
    (try KeyshareEnvelope.decrypt(after, keyAccount: testKey)) == plain,
    "migrated value opens to original")
  check(
    try KeyshareEnvelope.readItem(account: acct + "_migrating") == nil,
    "staging cleaned after promote")
  check(
    try !KeyshareEnvelope.ensureEnveloped(account: acct, keyAccount: testKey),
    "re-run is no-op")

  // Crash recovery: staging present + plaintext key → completes.
  let acct2 = "f15b1-test-keyshare2"
  try KeyshareEnvelope.deleteItem(account: acct2)
  try KeyshareEnvelope.deleteItem(account: acct2 + "_migrating")
  try KeyshareEnvelope.addItem(
    account: acct2, data: Data(plain.utf8),
    accessible: kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly)
  let stagedEnv = try KeyshareEnvelope.encrypt(plain, keyAccount: testKey)
  try KeyshareEnvelope.addItem(
    account: acct2 + "_migrating", data: Data(stagedEnv.utf8),
    accessible: kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly)
  check(
    try KeyshareEnvelope.ensureEnveloped(account: acct2, keyAccount: testKey),
    "crash recovery completes")
  let after2 = try KeyshareEnvelope.readItem(account: acct2).flatMap {
    String(data: $0, encoding: .utf8)
  }!
  check(
    (try KeyshareEnvelope.decrypt(after2, keyAccount: testKey)) == plain,
    "recovered value opens to original")

  // Corrupt value fails closed and is left untouched.
  let acct3 = "f15b1-test-keyshare3"
  try KeyshareEnvelope.deleteItem(account: acct3)
  try KeyshareEnvelope.deleteItem(account: acct3 + "_migrating")
  try KeyshareEnvelope.addItem(
    account: acct3, data: Data("definitely-not-a-keyshare".utf8),
    accessible: kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly)
  do {
    _ = try KeyshareEnvelope.ensureEnveloped(account: acct3, keyAccount: testKey)
    check(false, "corrupt value rejected")
  } catch { check(true, "corrupt value rejected") }
  let still = try KeyshareEnvelope.readItem(account: acct3).flatMap {
    String(data: $0, encoding: .utf8)
  }
  check(still == "definitely-not-a-keyshare", "corrupt value untouched")

  // Cleanup.
  for a in [acct, acct + "_migrating", acct2, acct2 + "_migrating", acct3, acct3 + "_migrating", testKey] {
    try KeyshareEnvelope.deleteItem(account: a)
  }
  check(try KeyshareEnvelope.readItem(account: testKey) == nil, "test key cleaned")
} catch {
  print("FAIL: unexpected throw: \(error)")
  failures += 1
}

if failures == 0 { print("ENVELOPE HARNESS PASSED") } else { print("FAILURES: \(failures)") }
exit(failures == 0 ? 0 : 1)
