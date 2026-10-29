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
    "https://mempool.space/testnet4/api",
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

  /// F11: URL shape validation for setAPI/setFeeAPIs. Mirrors
  /// Kotlin isAllowedApiUrlShape case-for-case. https allows any
  /// host; http/ws/wss are LAN-only (loopback/link-local/private
  /// literals + localhost, never DNS-resolved). Runs BEFORE the
  /// allowlist/token decision so garbage never prompts nor persists.
  static func isAllowedApiUrlShape(_ raw: String) -> Bool {
    let url = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if url.isEmpty { return false }
    guard let parts = URLComponents(string: url),
      let scheme = parts.scheme?.lowercased(),
      let host = parts.host, !host.isEmpty else { return false }
    if scheme == "https" { return true }
    if scheme == "http" || scheme == "ws" || scheme == "wss" {
      return isLanHost(host)
    }
    return false
  }

  /// Literal-only LAN check. Never resolves DNS.
  static func isLanHost(_ host: String) -> Bool {
    var h = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if h.hasSuffix(".") { h.removeLast() }
    if h == "localhost" { return true }
    let v4 = h.split(separator: ".", omittingEmptySubsequences: false)
    if v4.count == 4 {
      let octets = v4.map { Int($0) }
      for o in octets {
        guard let b = o, (0...255).contains(b) else { return false }
      }
      let a = octets[0]!, b = octets[1]!
      if a == 127 { return true }
      if a == 10 { return true }
      if a == 172 && (16...31).contains(b) { return true }
      if a == 192 && b == 168 { return true }
      if a == 169 && b == 254 { return true }
      return false
    }
    var bare = h
    if bare.hasPrefix("[") && bare.hasSuffix("]") {
      bare = String(bare.dropFirst().dropLast())
    }
    if bare == "::1" { return true }
    if bare.hasPrefix("fe80:") { return true }
    let first = bare.split(separator: ":").first.map(String.init) ?? ""
    if first.count >= 2 && first.count <= 4 && first.hasPrefix("f")
      && (first.dropFirst().hasPrefix("c") || first.dropFirst().hasPrefix("d"))
      && first.allSatisfy({ $0.isHexDigit }) { return true }
    return false
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
