import Foundation
import React

@objc(KeyshareShareModule)
class KeyshareShareModule: RCTEventEmitter {
  private static weak var sharedInstance: KeyshareShareModule?
  static let eventName = "keyshareSharedFile"

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
  func getInitialSharedKeyshareUri(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(KeyshareShareStorage.getPendingUri())
  }

  @objc
  func clearPendingSharedKeyshare(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    KeyshareShareStorage.clearPendingUri()
    resolve(nil)
  }

  static func notifyPendingShare() {
    guard let uri = KeyshareShareStorage.getPendingUri(), !uri.isEmpty else {
      return
    }
    sharedInstance?.sendEvent(withName: eventName, body: uri)
  }
}
