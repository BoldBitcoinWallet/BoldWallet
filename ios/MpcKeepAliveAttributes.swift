import Foundation

#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
struct MpcKeepAliveAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var percent: Int
    var status: String
    var camouflaged: Bool
  }

  var title: String
  var kind: String
}
#endif
