import RealityKit
import SwiftUI

/// Hosts the `SceneRunner` scene from `AppModel` and shows the hard-coded head path firing the trigger.
struct ViewportView: View {
    let model: AppModel

    var body: some View {
        RealityView { content in
            content.add(model.sceneRoot)
            let camera = PerspectiveCamera()
            camera.position = [0, 0.5, 4]
            content.add(camera)
        }
        .overlay(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.headInsideTrigger ? "Trigger: head inside" : "Trigger: head outside")
                    .font(.headline)
                Text("Frames \(model.framesRun) · output commands \(model.commandsSent)")
                    .font(.caption.monospacedDigit())
            }
            .padding(8)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 6))
            .padding()
        }
    }
}
