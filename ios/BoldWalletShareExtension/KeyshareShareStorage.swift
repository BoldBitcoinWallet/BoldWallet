import Foundation

enum KeyshareShareStorage {
  static let appGroupId = "group.org.reactjs.native.boldbtc.wallet"
  static let pendingUriKey = "pending_keyshare_uri"
  static let pendingFileName = "pending_keyshare.share"
  static let maxIncomingBytes = 1_048_576
  private static let walletExtensions: Set<String> = ["share", "psbt"]

  static var defaults: UserDefaults? {
    UserDefaults(suiteName: appGroupId)
  }

  static func storePendingUri(_ uri: String) {
    defaults?.set(uri, forKey: pendingUriKey)
    UserDefaults.standard.set(uri, forKey: pendingUriKey)
  }

  static func groupContainerURL() -> URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)
  }

  /// Chat and file apps often hand a UUID temp URL. The real name is
  /// `suggestedName` (wallet.share, tx.psbt). Stage a temp file with that
  /// extension, or sniff bytes when the name has neither. Photos, video,
  /// PDF, and zip are not wallet files.
  static func stageWalletFile(sourceURL: URL, suggestedName: String?) -> URL? {
    let accessing = sourceURL.startAccessingSecurityScopedResource()
    defer {
      if accessing {
        sourceURL.stopAccessingSecurityScopedResource()
      }
    }
    if hasWalletExtension(sourceURL) {
      return sourceURL
    }
    let hinted = (suggestedName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !hinted.isEmpty, hasWalletExtension(URL(fileURLWithPath: hinted)) {
      let leaf = (hinted as NSString).lastPathComponent
      if let copied = copyToTemporary(sourceURL, fileName: leaf) {
        return copied
      }
    }
    guard
      let data = try? Data(contentsOf: sourceURL),
      isPlausibleWalletPayload(data)
    else {
      return nil
    }
    return writeTemporary(data, fileName: walletFileName(for: data))
  }

  static func stageWalletData(_ data: Data, suggestedName: String?) -> URL? {
    guard isPlausibleWalletPayload(data) else {
      return nil
    }
    let hinted = (suggestedName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !hinted.isEmpty, hasWalletExtension(URL(fileURLWithPath: hinted)) {
      return writeTemporary(data, fileName: (hinted as NSString).lastPathComponent)
    }
    return writeTemporary(data, fileName: walletFileName(for: data))
  }

  private static func hasWalletExtension(_ url: URL) -> Bool {
    walletExtensions.contains(url.pathExtension.lowercased())
  }

  private static func walletFileName(for data: Data) -> String {
    isPsbtPayload(data) ? "pending_shared.psbt" : pendingFileName
  }

  private static func isPlausibleWalletPayload(_ data: Data) -> Bool {
    !data.isEmpty && data.count <= maxIncomingBytes && !isNonWalletPayload(data)
  }

  private static func isPsbtPayload(_ data: Data) -> Bool {
    data.count >= 4 && data.prefix(4) == Data([0x70, 0x73, 0x62, 0x74])
  }

  private static func isNonWalletPayload(_ data: Data) -> Bool {
    guard data.count >= 4 else {
      return false
    }
    let b = [UInt8](data.prefix(12))
    if b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff { return true }
    if b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4e && b[3] == 0x47 { return true }
    if b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46 { return true }
    if b[0] == 0x25 && b[1] == 0x50 && b[2] == 0x44 && b[3] == 0x46 { return true }
    if b[0] == 0x50 && b[1] == 0x4b && (b[2] == 0x03 || b[2] == 0x05 || b[2] == 0x07) { return true }
    if data.count >= 12 && b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 { return true }
    if data.count >= 8 && b[4] == 0x66 && b[5] == 0x74 && b[6] == 0x79 && b[7] == 0x70 { return true }
    return false
  }

  private static func copyToTemporary(_ sourceURL: URL, fileName: String) -> URL? {
    let dest = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
    try? FileManager.default.removeItem(at: dest)
    do {
      try FileManager.default.copyItem(at: sourceURL, to: dest)
      return dest
    } catch {
      return nil
    }
  }

  private static func writeTemporary(_ data: Data, fileName: String) -> URL? {
    let dest = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
    do {
      try data.write(to: dest, options: .atomic)
      return dest
    } catch {
      return nil
    }
  }

  @discardableResult
  static func copyIncomingFile(at sourceURL: URL) -> String? {
    guard let containerURL = groupContainerURL() else {
      return nil
    }
    let ext = sourceURL.pathExtension.lowercased()
    let fileName = (ext == "psbt" || ext == "share") ? "pending_shared.\(ext)" : pendingFileName
    let destinationURL = containerURL.appendingPathComponent(fileName)
    let fileManager = FileManager.default
    try? fileManager.removeItem(at: containerURL.appendingPathComponent(pendingFileName))
    try? fileManager.removeItem(at: containerURL.appendingPathComponent("pending_shared.share"))
    try? fileManager.removeItem(at: containerURL.appendingPathComponent("pending_shared.psbt"))
    try? fileManager.removeItem(at: destinationURL)
    do {
      if sourceURL.startAccessingSecurityScopedResource() {
        defer { sourceURL.stopAccessingSecurityScopedResource() }
        try fileManager.copyItem(at: sourceURL, to: destinationURL)
      } else {
        try fileManager.copyItem(at: sourceURL, to: destinationURL)
      }
      storePendingUri(destinationURL.path)
      return destinationURL.path
    } catch {
      return nil
    }
  }
}
