import Foundation
import React

@objc(IncomingUrlModule)
class IncomingUrlModule: RCTEventEmitter {
  private static weak var sharedInstance: IncomingUrlModule?
  static let eventName = "incomingUrl"
  private static let prefsKey = "pending_incoming_url"

  override init() {
    super.init()
    Self.sharedInstance = self
  }

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    [Self.eventName]
  }

  @objc
  func getInitialIncomingUrl(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(Self.getPendingUrl())
  }

  @objc
  func clearPendingIncomingUrl(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Self.clearPendingUrl()
    resolve(nil)
  }

  static func storePendingUrl(_ url: String) {
    UserDefaults.standard.set(url, forKey: prefsKey)
    KeyshareShareStorage.defaults?.set(url, forKey: prefsKey)
  }

  static func getPendingUrl() -> String? {
    if let url = KeyshareShareStorage.defaults?.string(forKey: prefsKey), !url.isEmpty {
      return url
    }
    if let url = UserDefaults.standard.string(forKey: prefsKey), !url.isEmpty {
      return url
    }
    return nil
  }

  static func clearPendingUrl() {
    UserDefaults.standard.removeObject(forKey: prefsKey)
    KeyshareShareStorage.defaults?.removeObject(forKey: prefsKey)
  }

  static func notifyPendingUrl() {
    guard let url = getPendingUrl(), !url.isEmpty else {
      return
    }
    sharedInstance?.sendEvent(withName: eventName, body: url)
  }
}
