import Foundation
import PearCore
import PearInput
import SwiftUI

/// Live debug overlay: one row per device with rate, latency, stale flag, source, schema errors and the last raw USIS
/// JSON. `source` is shown here only; it never reaches the runtime. Pure view over a `DeviceStats` snapshot.
struct DebugOverlayView: View {
    let stats: [DeviceStats]
    /// Packets rejected before a `deviceId` could be read (`InputPipeline.unattributedErrorCount`).
    let unattributedErrors: Int
    /// Host time in ms the rates are measured at (`HostClock.nowMs()`).
    let nowMs: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Debug overlay").font(.headline)
            if stats.isEmpty {
                Text("No devices").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(stats, id: \.deviceId) { device in
                DeviceRow(device: device, nowMs: nowMs)
            }
            if unattributedErrors > 0 {
                Text("Unattributed schema errors: \(unattributedErrors)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.red)
            }
        }
        .padding(8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 6))
    }

    /// Compact one-line raw JSON of a packet; empty when it cannot be encoded.
    static func rawJSON(_ packet: UsisPacket?) -> String {
        guard let packet else { return "" }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(packet) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    private struct DeviceRow: View {
        let device: DeviceStats
        let nowMs: Double

        var body: some View {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Circle().fill(device.stale ? Color.orange : Color.green).frame(width: 8, height: 8)
                    Text(device.deviceId).font(.subheadline.bold())
                    Text("\(device.kind.rawValue)/\(device.slot.rawValue)").font(.caption)
                    Text(device.source.rawValue)
                        .font(.caption2)
                        .padding(.horizontal, 4)
                        .background(.quaternary, in: Capsule())
                    if device.stale { Text("STALE").font(.caption2.bold()).foregroundStyle(.orange) }
                }
                Text(statsLine)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(device.schemaErrors > 0 ? Color.red : Color.secondary)
                Text(DebugOverlayView.rawJSON(device.lastPacket))
                    .font(.system(size: 10, design: .monospaced))
                    .lineLimit(2)
                    .foregroundStyle(.secondary)
            }
        }

        private var statsLine: String {
            let latency = device.clockSynced ? String(format: "%.0f ms", device.latencyMs) : "unsynced"
            return String(
                format: "%.0f Hz · latency %@ · gaps %d · schema errors %d",
                device.rateHz(at: nowMs), latency, device.seqGaps, device.schemaErrors
            )
        }
    }
}
