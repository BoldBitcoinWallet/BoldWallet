import Foundation
import UIKit

@objc(KeyshareShareAppDelegate)
class KeyshareShareAppDelegate: NSObject {
  @objc static func handleIncomingURL(_ url: URL) -> Bool {
    let scheme = url.scheme?.lowercased() ?? ""
    if scheme == "bitcoin" || scheme == "https" || scheme == "http" {
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
      IncomingUrlModule.storePendingUrl(url.absoluteString)
      IncomingUrlModule.notifyPendingUrl()
      return true
    }
    if url.isFileURL {
      if KeyshareShareStorage.copyIncomingFile(at: url) != nil {
        KeyshareShareModule.notifyPendingShare()
        return true
      }
    }
    return false
  }

  @objc static func handleUniversalLink(_ url: URL) -> Bool {
    guard url.scheme?.lowercased() == "https" else {
      return false
    }
    let host = url.host?.lowercased() ?? ""
    guard host == "boldbitcoinwallet.com" || host == "www.boldbitcoinwallet.com" else {
      return false
    }
    IncomingUrlModule.storePendingUrl(url.absoluteString)
    IncomingUrlModule.notifyPendingUrl()
    return true
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
