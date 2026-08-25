import Foundation
import React
import UIKit
import UserNotifications

#if canImport(ActivityKit)
import ActivityKit
#endif

@objc(MpcKeepAliveModule)
class MpcKeepAliveModule: NSObject {
  private static let notifId = "mpc-keep-alive-done"
  private static let returnNotifId = "mpc-keep-alive-return"
  private static var bgTask = UIBackgroundTaskIdentifier.invalid
  private static var running = false
  private static var camouflaged = false
  private static var lastPercent = 0
  private static var lastStatus = "Working…"
  private static var lastTitle = "Wallet setup"
  private static var lastKind = "keygen"
  private static var backgroundWarned = false

  @objc
  static func requiresMainQueueSetup() -> Bool {
    true
  }

  @objc
  func start(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let camouflaged = boolValue(options, "camouflaged")
    let status = (options["status"] as? String) ?? "Working…"
    let title = (options["title"] as? String) ?? "Wallet setup"
    let kind = (options["kind"] as? String) ?? "keygen"
    Self.camouflaged = camouflaged
    Self.lastStatus = status
    Self.lastTitle = title
    Self.lastKind = kind
    Self.lastPercent = 0
    Self.running = true
    Self.backgroundWarned = false
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = true
      Self.beginBgTask()
      Self.requestNotificationAuth()
      Self.startLiveActivity()
      resolve(true)
    }
  }

  @objc
  func update(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if let percent = intValue(options, "percent"), percent >= 0 {
      Self.lastPercent = min(99, percent)
    }
    if let status = options["status"] as? String, !status.isEmpty {
      Self.lastStatus = status
    }
    DispatchQueue.main.async {
      Self.updateLiveActivity()
    }
    resolve(true)
  }

  @objc
  func stop(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let outcome = (options["outcome"] as? String) ?? "failure"
    let title = (options["title"] as? String) ?? ""
    let body = (options["body"] as? String) ?? ""
    Self.running = false
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = false
      Self.endBgTask()
      Self.endLiveActivity(outcome: outcome, title: title, body: body)
      if outcome != "abort", !title.isEmpty {
        Self.postLocal(id: Self.notifId, title: title, body: body)
      }
      resolve(true)
    }
  }

  @objc
  func warnBackgrounded(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Self.postReturnToBoldIfNeeded()
    resolve(true)
  }

  @objc
  func isIgnoringBatteryOptimizations(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(true)
  }

  @objc
  func requestIgnoreBatteryOptimizations(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(false)
  }

  @objc
  static func onTssHook(_ json: String) {
    guard running else { return }
    guard let mapped = mapTssHook(json) else { return }
    lastPercent = mapped.0
    lastStatus = mapped.1
    DispatchQueue.main.async {
      updateLiveActivity()
    }
  }

  private static func mapTssHook(_ json: String) -> (Int, String)? {
    guard let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return nil
    }
    let type = (obj["type"] as? String) ?? ""
    if type == "transport" || type == "relay" {
      return nil
    }
    let step = obj["step"] as? Int ?? 0
    let done = obj["done"] as? Bool ?? false
    let percent: Int
    if done || step >= 99 {
      percent = 99
    } else if type == "keygen" {
      percent = min(95, max(1, step * 8))
    } else if type == "keysign" || type == "btc_send" || type == "psbt" {
      percent = min(95, max(1, step * 3))
    } else {
      percent = lastPercent
    }
    let status: String
    if camouflaged {
      status = percent > 0 ? "Working… \(percent)%" : "Working…"
    } else if done || step >= 99 {
      status = "Finishing…"
    } else if type == "keygen" {
      status = "Creating your wallet…"
    } else if type == "keysign" || type == "btc_send" || type == "psbt" {
      status = "Co-signing…"
    } else {
      status = lastStatus
    }
    return (percent, status)
  }

  private static func beginBgTask() {
    endBgTask()
    bgTask = UIApplication.shared.beginBackgroundTask(withName: "mpc-keep-alive") {
      postReturnToBoldIfNeeded()
      endLiveActivity(
        outcome: "failure",
        title: "Setup may have stopped",
        body: "Setup may have stopped — open Bold."
      )
      endBgTask()
    }
  }

  private static func endBgTask() {
    if bgTask != .invalid {
      UIApplication.shared.endBackgroundTask(bgTask)
      bgTask = .invalid
    }
  }

  private static func postReturnToBoldIfNeeded() {
    guard running, !backgroundWarned else { return }
    backgroundWarned = true
    if camouflaged {
      postLocal(id: returnNotifId, title: "Return", body: "Open the app to continue.")
    } else {
      postLocal(
        id: returnNotifId,
        title: "Return to Bold",
        body: "Setup may stop if you stay away."
      )
    }
  }

  private static func requestNotificationAuth() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in
    }
  }

  private static func postLocal(id: String, title: String, body: String) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    let request = UNNotificationRequest(
      identifier: id,
      content: content,
      trigger: nil
    )
    UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
  }

  private static func startLiveActivity() {
    #if canImport(ActivityKit)
    if #available(iOS 16.1, *) {
      MpcKeepAliveLiveActivityController.start(
        title: lastTitle,
        kind: lastKind,
        percent: lastPercent,
        status: lastStatus,
        camouflaged: camouflaged
      )
    }
    #endif
  }

  private static func updateLiveActivity() {
    #if canImport(ActivityKit)
    if #available(iOS 16.1, *) {
      MpcKeepAliveLiveActivityController.update(
        percent: lastPercent,
        status: lastStatus,
        camouflaged: camouflaged
      )
    }
    #endif
  }

  private static func endLiveActivity(outcome: String, title: String, body: String) {
    #if canImport(ActivityKit)
    if #available(iOS 16.1, *) {
      MpcKeepAliveLiveActivityController.end(
        outcome: outcome,
        title: title,
        body: body,
        camouflaged: camouflaged
      )
    }
    #endif
  }
}

#if canImport(ActivityKit)
@available(iOS 16.1, *)
enum MpcKeepAliveLiveActivityController {
  private static var activity: Activity<MpcKeepAliveAttributes>?

  static func start(
    title: String,
    kind: String,
    percent: Int,
    status: String,
    camouflaged: Bool
  ) {
    end(outcome: "abort", title: "", body: "", camouflaged: camouflaged)
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    let attrs = MpcKeepAliveAttributes(title: title, kind: kind)
    let state = MpcKeepAliveAttributes.ContentState(
      percent: percent,
      status: status,
      camouflaged: camouflaged
    )
    do {
      if #available(iOS 16.2, *) {
        let content = ActivityContent(state: state, staleDate: nil)
        activity = try Activity.request(attributes: attrs, content: content, pushType: nil)
      } else {
        activity = try Activity.request(
          attributes: attrs,
          contentState: state,
          pushType: nil
        )
      }
    } catch {
      activity = nil
    }
  }

  static func update(percent: Int, status: String, camouflaged: Bool) {
    guard let activity else { return }
    let state = MpcKeepAliveAttributes.ContentState(
      percent: percent,
      status: status,
      camouflaged: camouflaged
    )
    Task {
      if #available(iOS 16.2, *) {
        await activity.update(ActivityContent(state: state, staleDate: nil))
      } else {
        await activity.update(using: state)
      }
    }
  }

  static func end(outcome: String, title: String, body: String, camouflaged: Bool) {
    guard let current = activity else { return }
    activity = nil
    Task {
      if outcome == "abort" {
        if #available(iOS 16.2, *) {
          await current.end(nil, dismissalPolicy: .immediate)
        } else {
          await current.end(using: nil, dismissalPolicy: .immediate)
        }
        return
      }
      let status = body.isEmpty ? (camouflaged ? "Finished" : title) : body
      let percent: Int
      if #available(iOS 16.2, *) {
        percent = outcome == "success" ? 100 : current.content.state.percent
      } else {
        percent = outcome == "success" ? 100 : current.contentState.percent
      }
      let state = MpcKeepAliveAttributes.ContentState(
        percent: percent,
        status: status,
        camouflaged: camouflaged
      )
      if #available(iOS 16.2, *) {
        await current.end(
          ActivityContent(state: state, staleDate: nil),
          dismissalPolicy: .default
        )
      } else {
        await current.end(using: state, dismissalPolicy: .default)
      }
    }
  }
}
#endif

private func boolValue(_ options: NSDictionary, _ key: String) -> Bool {
  if let n = options[key] as? NSNumber {
    return n.boolValue
  }
  return (options[key] as? Bool) ?? false
}

private func intValue(_ options: NSDictionary, _ key: String) -> Int? {
  if let n = options[key] as? NSNumber {
    return n.intValue
  }
  return options[key] as? Int
}
