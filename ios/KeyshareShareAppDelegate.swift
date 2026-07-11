import Foundation
import UIKit

@objc(KeyshareShareAppDelegate)
class KeyshareShareAppDelegate: NSObject {
  private static let supportedSharedExtensions: Set<String> = ["share", "psbt"]

  @objc static func handleIncomingURL(_ url: URL) -> Bool {
    let scheme = url.scheme?.lowercased() ?? ""
    if scheme == "bitcoin" {
      IncomingUrlModule.storePendingUrl(url.absoluteString)
      IncomingUrlModule.notifyPendingUrl()
      return true
    }
    if scheme == "boldwallet" {
      let host = url.host?.lowercased() ?? ""
      let path = url.path.lowercased()
      if host == "import-keyshare" || path.contains("import-keyshare") {
        KeyshareShareModule.notifyPendingShare()
        return true
      }
      return false
    }
    if url.isFileURL {
      let ext = url.pathExtension.lowercased()
      if supportedSharedExtensions.contains(ext), KeyshareShareStorage.copyIncomingFile(at: url) != nil {
        KeyshareShareModule.notifyPendingShare()
        return true
      }
    }
    return false
  }

  @objc static func handleLaunchOptions(_ launchOptions: [AnyHashable: Any]?) {
    guard
      let launchOptions,
      let url = launchOptions[UIApplication.LaunchOptionsKey.url] as? URL
    else {
      return
    }
    _ = handleIncomingURL(url)
  }
}
