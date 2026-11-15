import Foundation
import Testing
import RealityKit
import PearCore
@testable import PearRuntime

@MainActor
struct SceneLoaderTests {
    private let json = """
    {
      "name": "demo",
      "requiredTier": 3,
      "playerOrigin": [0, 1.6, 2],
      "runMode": "device",
      "clientScripts": ["enemy"],
      "serverScripts": ["game"],
      "entities": [
        {
          "name": "enemy",
          "position": [1, 2, 3],
          "scale": [2, 2, 2],
          "components": [
            { "type": "script", "name": "enemy" },
            { "type": "audioEmitter", "soundName": "growl", "gain": -6, "loops": true },
            { "type": "trigger", "shape": "sphere", "radius": 0.5, "probeSlots": ["head", "hand"] }
          ],
          "children": [
            { "name": "zone", "components": [ { "type": "trigger", "shape": "box", "size": [1, 2, 3] } ] }
          ]
        }
      ]
    }
    """

    @Test func decodesFieldsAndDefaults() throws {
        let scene = try SceneLoader.decode(Data(json.utf8))
        #expect(scene.requiredTier == 3)
        #expect(scene.playerOrigin == Vector3(0, 1.6, 2))
        #expect(scene.runMode == .device)
        #expect(scene.clientScripts == ["enemy"])
        #expect(scene.serverScripts == ["game"])

        let empty = try SceneLoader.decode(Data("{}".utf8))
        #expect(empty.requiredTier == 1)
        #expect(empty.runMode == .screen)
        #expect(empty.playerOrigin == .zero)
        #expect(empty.entities.isEmpty)
    }

    @Test func buildsEntitiesTransformsAndComponents() throws {
        let scene = try SceneLoader.decode(Data(json.utf8))
        let root = try SceneLoader.load(scene)
        let enemy = try #require(root.children.first)
        #expect(enemy.name == "enemy")
        #expect(enemy.position == SIMD3<Float>(1, 2, 3))
        #expect(enemy.scale == SIMD3<Float>(2, 2, 2))
        #expect(enemy.components[ScriptComponent.self]?.scriptName == "enemy")

        let audio = try #require(enemy.components[AudioEmitterComponent.self])
        #expect(audio.soundName == "growl")
        #expect(audio.gain == -6)
        #expect(audio.loops)

        let trigger = try #require(enemy.components[TriggerComponent.self])
        #expect(trigger.shape == .sphere(radius: 0.5))
        #expect(trigger.probeSlots == [.head, .hand])

        let zone = try #require(enemy.children.first)
        #expect(zone.name == "zone")
        #expect(zone.components[TriggerComponent.self]?.shape == .box(size: SIMD3<Float>(1, 2, 3)))
        #expect(zone.components[TriggerComponent.self]?.probeSlots == [.head])
    }

    @Test func unknownComponentIsRejectedCleanly() {
        let bad = #"{ "entities": [ { "components": [ { "type": "teleporter" } ] } ] }"#
        #expect(throws: DecodingError.self) {
            try SceneLoader.decode(Data(bad.utf8))
        }
    }

    @Test func outOfRangeTierIsRejected() {
        #expect(throws: DecodingError.self) {
            try SceneLoader.decode(Data(#"{ "requiredTier": 4 }"#.utf8))
        }
        #expect(throws: SceneLoader.LoadError.invalidTier(0)) {
            try SceneLoader.load(SceneDescription(requiredTier: 0))
        }
    }

    @Test func nonPositiveShapeIsRejected() {
        let scene = SceneDescription(entities: [
            EntityDescription(components: [.trigger(shape: .sphere(radius: 0), probeSlots: [.head])])
        ])
        #expect(throws: SceneLoader.LoadError.self) {
            try SceneLoader.load(scene)
        }
    }

    @Test func descriptionRoundTrips() throws {
        let scene = try SceneLoader.decode(Data(json.utf8))
        let data = try JSONEncoder().encode(scene)
        #expect(try SceneLoader.decode(data) == scene)
    }
}
