import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.1, *)
struct MpcKeepAliveLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: MpcKeepAliveAttributes.self) { context in
      lockScreen(context: context)
        .padding(12)
        .activityBackgroundTint(Color.black.opacity(0.85))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text(displayTitle(context))
            .font(.caption.weight(.semibold))
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text("\(context.state.percent)%")
            .font(.caption.monospacedDigit())
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(displayStatus(context))
            .font(.caption2)
            .lineLimit(2)
          ProgressView(value: Double(context.state.percent), total: 100)
            .tint(.orange)
        }
      } compactLeading: {
        Text(displayTitle(context))
          .font(.caption2)
          .lineLimit(1)
      } compactTrailing: {
        Text("\(context.state.percent)%")
          .font(.caption2.monospacedDigit())
      } minimal: {
        Text("\(context.state.percent)")
          .font(.caption2.monospacedDigit())
      }
    }
  }

  @ViewBuilder
  private func lockScreen(context: ActivityViewContext<MpcKeepAliveAttributes>) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(displayTitle(context))
          .font(.headline)
        Spacer()
        Text("\(context.state.percent)%")
          .font(.headline.monospacedDigit())
      }
      Text(displayStatus(context))
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .lineLimit(2)
      ProgressView(value: Double(context.state.percent), total: 100)
        .tint(.orange)
    }
    .foregroundStyle(.white)
  }

  private func displayTitle(
    _ context: ActivityViewContext<MpcKeepAliveAttributes>
  ) -> String {
    context.state.camouflaged ? context.attributes.title : context.attributes.title
  }

  private func displayStatus(
    _ context: ActivityViewContext<MpcKeepAliveAttributes>
  ) -> String {
    if context.state.camouflaged {
      return context.state.percent > 0
        ? "Working… \(context.state.percent)%"
        : "Working…"
    }
    return context.state.status
  }
}
