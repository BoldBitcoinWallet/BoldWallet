import Foundation
import React

@objc(KeyshareShareModule)
class KeyshareShareModule: RCTEventEmitter {
  private static weak var sharedInstance: KeyshareShareModule?
  private static var hasPendingNotification = false
  static let eventName = "keyshareSharedFile"
  private var hasListeners = false

  override init() {
    super.init()
    Self.sharedInstance = self
    Self.emitPendingShareIfPossible()
  }

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    [Self.eventName]
  }

  override func startObserving() {
    hasListeners = true
    Self.emitPendingShareIfPossible()
  }

  override func stopObserving() {
    hasListeners = false
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
    let notify = {
      guard let uri = KeyshareShareStorage.getPendingUri(), !uri.isEmpty else {
        hasPendingNotification = false
        return
      }
      hasPendingNotification = true
      emitPendingShareIfPossible()
    }

    if Thread.isMainThread {
      notify()
    } else {
      DispatchQueue.main.async {
        notify()
      }
    }
  }

  private static func emitPendingShareIfPossible() {
    guard hasPendingNotification else {
      return
    }
    guard
      let instance = sharedInstance,
      instance.hasListeners,
      let uri = KeyshareShareStorage.getPendingUri(),
      !uri.isEmpty
    else {
      return
    }

    instance.sendEvent(withName: eventName, body: uri)
    hasPendingNotification = false
  }
}
