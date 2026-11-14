import Foundation
import Testing
import RealityKit
import OmniCore
@testable import OmniRuntime

private func target(id: UInt64, center: SIMD3<Float>, half: Float = 0.5) -> RaycastTarget {
    var m = matrix_identity_float4x4
    m.columns.3 = SIMD4(center, 1)
    return RaycastTarget(id: id, worldToLocal: m.inverse, boundsMin: SIMD3(repeating: -half), boundsMax: SIMD3(repeating: half))
}

@MainActor
private func box(_ name: String, at position: SIMD3<Float>, in root: Entity) -> Entity {
    let e = Entity()
    e.name = name
    e.position = position
    e.components.set(CollisionComponent(shapes: [.generateBox(size: SIMD3(repeating: 1))]))
    root.addChild(e)
    return e
}

private func frame(orientation: Quaternion = Quaternion(0, 0, 0, 1), stale: Bool = false,
                   slot: Slot = .head, position: Vector3? = nil) -> InputFrame {
    InputFrame(timestamp: 0, devices: [
        DeviceSample(deviceId: "d", kind: .headset, slot: slot, stale: stale, orientation: orientation, position: position)
    ])
}

@Test func pureRayHitsAndMisses() {
    let t = target(id: 1, center: SIMD3(0, 0, -5))
    #expect(RaycastHitDetector.nearestHit(origin: .zero, direction: SIMD3(0, 0, -1), targets: [t]) == 1)
    #expect(RaycastHitDetector.nearestHit(origin: .zero, direction: SIMD3(0, 0, 1), targets: [t]) == nil)
    #expect(RaycastHitDetector.nearestHit(origin: .zero, direction: SIMD3(1, 0, 0), targets: [t]) == nil)
    #expect(RaycastHitDetector.nearestHit(origin: .zero, direction: SIMD3(0, 0, -1), targets: []) == nil)
}

@Test func pureRayReturnsNearestOnly() {
    let far = target(id: 1, center: SIMD3(0, 0, -9))
    let near = target(id: 2, center: SIMD3(0, 0, -3))
    #expect(RaycastHitDetector.nearestHit(origin: .zero, direction: SIMD3(0, 0, -1), targets: [far, near]) == 2)
}

@MainActor
@Test func detectorFiresOncePerHitAndAgainAfterMiss() {
    let root = Entity()
    let e = box("a", at: SIMD3(0, 0, -5), in: root)
    let detector = RaycastHitDetector()
    let aimed = frame()
    let away = frame(orientation: Quaternion(0, 1, 0, 0)) // 180° about Y: looks along +Z
    #expect(detector.derive(from: aimed, deltaTime: 0.016, root: root) == [.raycastHit(entity: e.id, slot: .head)])
    #expect(detector.derive(from: aimed, deltaTime: 0.016, root: root).isEmpty)
    #expect(detector.derive(from: away, deltaTime: 0.016, root: root).isEmpty)
    #expect(detector.derive(from: aimed, deltaTime: 0.016, root: root) == [.raycastHit(entity: e.id, slot: .head)])
}

@MainActor
@Test func detectorHitsNearestEntityOnly() {
    let root = Entity()
    _ = box("far", at: SIMD3(0, 0, -9), in: root)
    let near = box("near", at: SIMD3(0, 0, -3), in: root)
    let events = RaycastHitDetector().derive(from: frame(), deltaTime: 0.016, root: root)
    #expect(events == [.raycastHit(entity: near.id, slot: .head)])
}

@MainActor
@Test func detectorUsesDevicePositionAndIgnoresStaleAndOtherSlots() {
    let root = Entity()
    let e = box("a", at: SIMD3(10, 0, -5), in: root)
    let detector = RaycastHitDetector()
    #expect(detector.derive(from: frame(), deltaTime: 0.016, root: root).isEmpty)
    let p = Vector3(10, 0, 0)
    #expect(detector.derive(from: frame(position: p), deltaTime: 0.016, root: root)
        == [.raycastHit(entity: e.id, slot: .head)])
    let other = RaycastHitDetector()
    #expect(other.derive(from: frame(slot: .leftWrist, position: p), deltaTime: 0.016, root: root).isEmpty)
    let stale = RaycastHitDetector()
    #expect(stale.derive(from: frame(stale: true, position: p), deltaTime: 0.016, root: root).isEmpty)
}
