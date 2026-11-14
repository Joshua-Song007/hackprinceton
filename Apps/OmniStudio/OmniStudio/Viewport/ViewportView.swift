import RealityKit
import SwiftUI

/// Hosts the `SceneRunner` scene from `AppModel` and shows the hard-coded head path firing the trigger.
struct ViewportView: View {
    let model: AppModel

    var body: some View {
        RealityView { content in
            content.add(model.sceneRoot)
            let camera = PerspectiveCamera()
            let o = model.playerOrigin
            camera.position = [Float(o.x), Float(o.y) + 0.5, Float(o.z) + 4]
            content.add(camera)
        }
        .overlay(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.gameName ?? "No game loaded")
                    .font(.headline)
                if let error = model.loadError {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
                Text("Frames \(model.framesRun) · output commands \(model.commandsSent)")
                    .font(.caption.monospacedDigit())
                ForEach(Array(model.scriptErrors.suffix(3).enumerated()), id: \.offset) { _, error in
                    Text(error).font(.caption2).foregroundStyle(.orange).lineLimit(2)
                }
            }
            .padding(8)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 6))
            .padding()
        }
    }
}
