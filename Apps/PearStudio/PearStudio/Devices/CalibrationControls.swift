import PearCore
import PearInput
import SwiftUI

/// "Face forward and tap" calibration flow. AirPods calibrate yaw-only (`CalibrationMode.default(for:)`).
struct CalibrationControls: View {
    let pipeline: InputPipeline

    @State private var selectedId: String?
    @State private var message = ""

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let stats = pipeline.statsSnapshot()
            VStack(alignment: .leading, spacing: 8) {
                Picker("Device", selection: $selectedId) {
                    Text("Select a device").tag(String?.none)
                    ForEach(stats, id: \.deviceId) { stat in
                        Text(stat.deviceId).tag(Optional(stat.deviceId))
                    }
                }
                if let stat = stats.first(where: { $0.deviceId == selectedId }) {
                    let mode = CalibrationMode.default(for: stat.kind)
                    Text(mode == .yawOnly ? "Face forward, then tap (yaw only)" : "Face forward, then tap")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Button("Calibrate") { calibrate() }
                        .disabled(selectedId == nil)
                    Button("Reset") { reset() }
                        .disabled(selectedId == nil)
                }
                if !message.isEmpty {
                    Text(message).font(.caption)
                }
            }
            .padding()
        }
    }

    private func calibrate() {
        guard let id = selectedId else { return }
        message = pipeline.calibrate(deviceId: id)
            ? "Calibrated \(id)"
            : "No orientation yet from \(id)"
    }

    private func reset() {
        guard let id = selectedId else { return }
        pipeline.resetCalibration(deviceId: id)
        message = "Reset \(id)"
    }
}
