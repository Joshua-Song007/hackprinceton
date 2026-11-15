import Foundation
import Testing
import RealityKit
import PearCore
@testable import PearRuntime

@MainActor
struct LookAtDetectorTests {
    private func scene(at position: SIMD3<Float>) -> (Entity, Entity) {
        let root = Entity()
        let target = Entity()
        target.position = position
        target.components.set(ScriptComponent(scriptName: "t"))
        root.addChild(target)
        return (root, target)
    }

    private func frame(_ q: Quaternion, position: Vector3? = nil, stale: Bool = false) -> InputFrame {
        InputFrame(timestamp: 0, devices: [
            DeviceSample(deviceId: "h", kind: .airpods, slot: .head, stale: stale, orientation: q, position: position)
        ])
    }

    /// Rotation about +Y by `degrees`.
    private func yaw(_ degrees: Double) -> Quaternion {
        let h = degrees * .pi / 180 / 2
        return Quaternion(0, sin(h), 0, cos(h))
    }

    @Test func identityHeadLooksDownMinusZ() {
        let f = LookAtDetector.forward(of: .identity)
        #expect(abs(f.x) < 1e-9 && abs(f.y) < 1e-9 && abs(f.z + 1) < 1e-9)
    }

    @Test func firesAfterDwellOnlyOnce() {
        let (root, target) = scene(at: [0, 0, -3])
        let d = LookAtDetector()
        #expect(d.derive(from: frame(.identity), deltaTime: 0.25, root: root).isEmpty)
        #expect(d.derive(from: frame(.identity), deltaTime: 0.25, root: root) == [.lookAt(entity: target.id)])
        #expect(d.derive(from: frame(.identity), deltaTime: 0.25, root: root).isEmpty)
    }

    @Test func outsideThresholdNeverFires() {
        let (root, _) = scene(at: [0, 0, -3])
        let d = LookAtDetector()
        // 20° off axis is outside the 15° cone.
        for _ in 0..<10 { #expect(d.derive(from: frame(yaw(20)), deltaTime: 0.2, root: root).isEmpty) }
    }

    @Test func insideThresholdFires() {
        let (root, target) = scene(at: [0, 0, -3])
        let d = LookAtDetector()
        // 10° off axis is inside.
        #expect(d.derive(from: frame(yaw(10)), deltaTime: 0.6, root: root) == [.lookAt(entity: target.id)])
    }

    @Test func leavingGazeResetsDwellAndRearms() {
        let (root, target) = scene(at: [0, 0, -3])
        let d = LookAtDetector()
        #expect(d.derive(from: frame(.identity), deltaTime: 0.4, root: root).isEmpty)
        #expect(d.derive(from: frame(yaw(90)), deltaTime: 0.1, root: root).isEmpty)
        // 0.4 s again is not enough because the timer reset.
        #expect(d.derive(from: frame(.identity), deltaTime: 0.4, root: root).isEmpty)
        #expect(d.derive(from: frame(.identity), deltaTime: 0.2, root: root) == [.lookAt(entity: target.id)])
        // Look away and back: fires again.
        _ = d.derive(from: frame(yaw(90)), deltaTime: 0.1, root: root)
        #expect(d.derive(from: frame(.identity), deltaTime: 0.5, root: root) == [.lookAt(entity: target.id)])
    }

    @Test func fallsBackToPlayerOrigin() {
        let (root, target) = scene(at: [5, 1.6, 0])
        let d = LookAtDetector(playerOrigin: Vector3(0, 1.6, 0))
        // Looking along +X: yaw −90° maps −Z to +X.
        #expect(d.derive(from: frame(yaw(-90)), deltaTime: 0.5, root: root) == [.lookAt(entity: target.id)])
    }

    @Test func headPositionOverridesPlayerOrigin() {
        let (root, target) = scene(at: [0, 0, -3])
        let d = LookAtDetector(playerOrigin: Vector3(50, 0, 0))
        #expect(d.derive(from: frame(.identity), deltaTime: 0.5, root: root).isEmpty)
        #expect(d.derive(from: frame(.identity, position: .zero), deltaTime: 0.5, root: root) == [.lookAt(entity: target.id)])
    }

    @Test func staleOrMissingHeadEmitsNothingAndFreezesTimer() {
        let (root, target) = scene(at: [0, 0, -3])
        let d = LookAtDetector()
        #expect(d.derive(from: frame(.identity), deltaTime: 0.3, root: root).isEmpty)
        #expect(d.derive(from: frame(.identity, stale: true), deltaTime: 1, root: root).isEmpty)
        #expect(d.derive(from: .empty, deltaTime: 1, root: root).isEmpty)
        #expect(d.derive(from: frame(.identity), deltaTime: 0.2, root: root) == [.lookAt(entity: target.id)])
    }

    @Test func entitiesWithoutScriptAreIgnored() {
        let root = Entity()
        let plain = Entity()
        plain.position = [0, 0, -3]
        root.addChild(plain)
        #expect(LookAtDetector().derive(from: frame(.identity), deltaTime: 1, root: root).isEmpty)
    }

    @Test func targetAtHeadPositionNeverLocks() {
        let (root, _) = scene(at: [0, 0, 0])
        #expect(LookAtDetector().derive(from: frame(.identity), deltaTime: 1, root: root).isEmpty)
    }
}
