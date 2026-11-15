import Foundation
import PearCore
import RealityKit
import simd

/// One raycast-testable volume: an entity's collision bounds, placed in the world by `worldToLocal`'s inverse.
public struct RaycastTarget: Equatable, Sendable {
    public var id: Entity.ID
    /// Inverse of the entity's world transform.
    public var worldToLocal: simd_float4x4
    /// Axis-aligned bounds in the entity's local space.
    public var boundsMin: SIMD3<Float>
    public var boundsMax: SIMD3<Float>

    public init(id: Entity.ID, worldToLocal: simd_float4x4, boundsMin: SIMD3<Float>, boundsMax: SIMD3<Float>) {
        self.id = id
        self.worldToLocal = worldToLocal
        self.boundsMin = boundsMin
        self.boundsMax = boundsMax
    }
}

/// Fires `onRaycastHit` when a device's aim ray (forward = −Z of its orientation) first hits a collision entity.
/// The hit test is pure math over collision bounds (slab test in each entity's local space), not a RealityKit scene
/// query, so it resolves inside `SceneRunner.step` and runs headless. Bounds are the entity's `CollisionComponent`
/// shape bounds, so curved shapes are matched by their bounding box.
@MainActor
public final class RaycastHitDetector: EventDeriver {
    /// Slots whose devices aim a ray (phone aim, simulator gaze).
    public var aimSlots: Set<Slot>
    /// Ray origin when the device reports no `position`.
    public var playerOrigin: SIMD3<Float>
    private var lastHit: [Slot: Entity.ID] = [:]

    public init(aimSlots: Set<Slot> = [.head, .hand], playerOrigin: SIMD3<Float> = .zero) {
        self.aimSlots = aimSlots
        self.playerOrigin = playerOrigin
    }

    public func derive(from frame: InputFrame, deltaTime: TimeInterval, root: Entity) -> [GameEvent] {
        let targets = Self.targets(in: root)
        var events: [GameEvent] = []
        var seen = Set<Slot>()
        for device in frame.devices.sorted(by: { $0.slot.rawValue < $1.slot.rawValue })
        where !device.stale && aimSlots.contains(device.slot) {
            guard let q = device.orientation, seen.insert(device.slot).inserted else { continue }
            let origin = device.position.map { SIMD3<Float>(Float($0.x), Float($0.y), Float($0.z)) } ?? playerOrigin
            let rotation = simd_quatf(ix: Float(q.x), iy: Float(q.y), iz: Float(q.z), r: Float(q.w))
            let direction = rotation.act(SIMD3<Float>(0, 0, -1))
            let hit = Self.nearestHit(origin: origin, direction: direction, targets: targets)
            if let hit {
                if lastHit[device.slot] != hit {
                    events.append(.raycastHit(entity: hit, slot: device.slot))
                }
                lastHit[device.slot] = hit
            } else {
                lastHit[device.slot] = nil
            }
        }
        // A device that went stale or vanished forgets its hit so it can fire again on return.
        for slot in lastHit.keys where !seen.contains(slot) {
            lastHit[slot] = nil
        }
        return events
    }

    /// Nearest target the ray hits, or `nil`. Pure function; a ray that starts inside a volume hits it at distance 0.
    public nonisolated static func nearestHit(
        origin: SIMD3<Float>, direction: SIMD3<Float>, targets: [RaycastTarget]
    ) -> Entity.ID? {
        var best: (id: Entity.ID, distance: Float)?
        for target in targets {
            guard let d = distance(origin: origin, direction: direction, target: target) else { continue }
            if let current = best, current.distance <= d { continue }
            best = (target.id, d)
        }
        return best?.id
    }

    /// Distance along the world ray to the target's bounds, scale-corrected, or `nil` on a miss.
    nonisolated static func distance(origin: SIMD3<Float>, direction: SIMD3<Float>, target: RaycastTarget) -> Float? {
        let o = target.worldToLocal * SIMD4<Float>(origin, 1)
        let dv = target.worldToLocal * SIMD4<Float>(direction, 0)
        let lo = SIMD3<Float>(o.x, o.y, o.z)
        let ld = SIMD3<Float>(dv.x, dv.y, dv.z)
        var tMin: Float = 0
        var tMax = Float.greatestFiniteMagnitude
        for axis in 0..<3 {
            if abs(ld[axis]) < 1e-9 {
                if lo[axis] < target.boundsMin[axis] || lo[axis] > target.boundsMax[axis] { return nil }
            } else {
                let t1 = (target.boundsMin[axis] - lo[axis]) / ld[axis]
                let t2 = (target.boundsMax[axis] - lo[axis]) / ld[axis]
                tMin = max(tMin, min(t1, t2))
                tMax = min(tMax, max(t1, t2))
                if tMin > tMax { return nil }
            }
        }
        // Local-space t equals world-space t because the direction was transformed, not renormalized.
        return tMin
    }

    /// Every entity under `root` with a `CollisionComponent`, as a raycast target.
    static func targets(in root: Entity) -> [RaycastTarget] {
        var result: [RaycastTarget] = []
        func visit(_ entity: Entity) {
            if let collision = entity.components[CollisionComponent.self], let first = collision.shapes.first {
                var lo = first.bounds.min
                var hi = first.bounds.max
                for shape in collision.shapes.dropFirst() {
                    lo = simd_min(lo, shape.bounds.min)
                    hi = simd_max(hi, shape.bounds.max)
                }
                result.append(RaycastTarget(
                    id: entity.id,
                    worldToLocal: entity.transformMatrix(relativeTo: nil).inverse,
                    boundsMin: lo,
                    boundsMax: hi))
            }
            for child in entity.children { visit(child) }
        }
        visit(root)
        return result
    }
}
