import Foundation

// 3b-2d B15/B16: native-held mempool API allowlist. Pure Swift
// (no RN deps) so the ceremony-harness compiles this file
// standalone. Mirrors android CeremonyApiAllowlist.kt.
//
// Rule: setAPI/setFeeAPIs apply silently iff every URL is
// allowlisted; otherwise a valid `config` ceremony token is
// required, and the approved URLs are persisted. Malicious JS
// can neither add hosts (no bridge writer except the gated
// methods) nor bypass the prompt (native verify).
//
// Seeds must match services/mempoolApiBase.ts defaults. Drift
// fails SAFE: an unknown default prompts, never silently allows.
enum CeremonyApiAllowlist {
  static let seeds: Set<String> = [
    "https://mempool.space/api",
    "https://mempool.space/testnet/api",
  ]

  /// Trim + strip trailing slashes. Compared and stored normalized.
  static func normalize(_ url: String) -> String {
    var s = url.trimmingCharacters(in: .whitespacesAndNewlines)
    while s.hasSuffix("/") { s.removeLast() }
    return s
  }

  /// Split a setFeeAPIs CSV into normalized non-empty URLs.
  static func parseCsv(_ csv: String) -> [String] {
    csv.split(separator: ",").map { normalize(String($0)) }.filter { !$0.isEmpty }
  }

  /// Injectable store. Prod = UserDefaults key with no other
  /// writer (grep-verified); tests = in-memory.
  struct Store {
    var load: () -> Set<String>
    var save: (Set<String>) -> Void
  }

  static func isAllowed(_ url: String, store: Store) -> Bool {
    let normalized = normalize(url)
    if normalized.isEmpty { return false }
    if seeds.contains(normalized) { return true }
    return store.load().contains(normalized)
  }

  /// Merge normalized non-empty URLs into the store.
  static func persist(_ urls: [String], store: Store) {
    var merged = store.load()
    var changed = false
    for url in urls {
      let normalized = normalize(url)
      if !normalized.isEmpty && merged.insert(normalized).inserted {
        changed = true
      }
    }
    if changed {
      store.save(merged)
    }
  }

  enum Decision {
    /// All URLs allowlisted — apply, persist nothing.
    case apply
    /// Valid config token — apply and persist the new URLs.
    case applyAndPersist
    /// Unknown URLs, no (valid) token — reject.
    case reject
  }

  /// Pure gate decision. Empty URL list applies vacuously (no
  /// host is pointed anywhere; Go keeps its previous behavior).
  static func decide(urls: [String], token: String, sessionID: String, store: Store) -> Decision {
    if urls.allSatisfy({ isAllowed($0, store: store) }) {
      return .apply
    }
    if !token.isEmpty && !sessionID.isEmpty
      && CeremonyTokens.verify(token: token, opClass: .config, sessionID: sessionID) {
      return .applyAndPersist
    }
    return .reject
  }
}
