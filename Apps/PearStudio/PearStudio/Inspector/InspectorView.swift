import PearRuntime
import RealityKit
import SwiftUI

/// Entity inspector: shows an entity's name, transform and runtime components, and assigns or clears its script.
struct InspectorView: View {
    let entity: Entity
    /// Script names the user can pick from (for example the names loaded into the `ScriptReloader`).
    let availableScripts: [String]
    @State private var scriptName = ""

    var body: some View {
        Form {
            Section("Entity") {
                LabeledContent("Name", value: entity.name.isEmpty ? "(unnamed)" : entity.name)
                LabeledContent("Position", value: Self.format(entity.position))
            }
            Section("Components") {
                if let trigger = entity.components[TriggerComponent.self] {
                    LabeledContent("Trigger", value: "\(trigger.shape) · \(trigger.occupants.count) inside")
                }
                if let audio = entity.components[AudioEmitterComponent.self] {
                    LabeledContent("Audio", value: "\(audio.soundName)\(audio.loops ? " (loop)" : "")")
                }
                if entity.components[TriggerComponent.self] == nil, entity.components[AudioEmitterComponent.self] == nil {
                    Text("None").foregroundStyle(.secondary)
                }
            }
            Section("Script") {
                Picker("Script", selection: $scriptName) {
                    Text("None").tag("")
                    ForEach(availableScripts, id: \.self) { Text($0).tag($0) }
                }
                .onChange(of: scriptName) { _, newValue in assign(newValue) }
            }
        }
        .formStyle(.grouped)
        .onAppear { scriptName = entity.components[ScriptComponent.self]?.scriptName ?? "" }
    }

    private func assign(_ name: String) {
        if name.isEmpty {
            entity.components.remove(ScriptComponent.self)
        } else {
            entity.components.set(ScriptComponent(scriptName: name))
        }
    }

    private static func format(_ v: SIMD3<Float>) -> String {
        String(format: "%.2f, %.2f, %.2f", v.x, v.y, v.z)
    }
}
