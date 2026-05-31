import Foundation

enum KeyshareShareStorage {
  static let appGroupId = "group.org.reactjs.native.boldbtc.wallet"
  static let pendingUriKey = "pending_keyshare_uri"
  static let pendingFileName = "pending_keyshare.share"

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

  @discardableResult
  static func copyIncomingFile(at sourceURL: URL) -> String? {
    guard let containerURL = groupContainerURL() else {
      return nil
    }
    let destinationURL = containerURL.appendingPathComponent(pendingFileName)
    let fileManager = FileManager.default
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
