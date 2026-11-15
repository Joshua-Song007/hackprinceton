import PearCore
import PearInput
import SwiftUI

/// Connected devices with rate, latency and stale indicators, read from `InputPipeline.statsSnapshot()`.
/// Battery is not part of USIS v1, so it is not shown.
struct DeviceStatusView: View {
    let pipeline: InputPipeline

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { _ in
            let stats = pipeline.statsSnapshot()
            let now = HostClock.nowMs()
            List {
                if stats.isEmpty {
                    Text("No devices connected").foregroundStyle(.secondary)
                }
                ForEach(stats, id: \.deviceId) { stat in
                    DeviceStatusRow(stat: stat, nowMs: now)
                }
            }
        }
    }
}

private struct DeviceStatusRow: View {
    let stat: DeviceStats
    let nowMs: Double

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(stat.stale ? Color.orange : Color.green)
                .frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 2) {
                Text(stat.deviceId).font(.headline)
                Text("\(stat.kind.rawValue) · \(stat.slot.rawValue) · \(stat.source.rawValue)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(Int(stat.rateHz(at: nowMs))) Hz")
                Text(stat.clockSynced ? "\(Int(stat.latencyMs)) ms" : "unsynced")
                    .foregroundStyle(.secondary)
            }
            .font(.caption.monospacedDigit())
            if stat.stale {
                Text("STALE").font(.caption.bold()).foregroundStyle(.orange)
            }
        }
    }
}
