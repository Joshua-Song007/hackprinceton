import Foundation
import OmniCore
import RealityKit

/// Fires `.lookAt` for a scripted entity once the head forward vector `f` has stayed within `lockAngle` of the
/// direction `ŝ` to that entity for `dwell` seconds. Head forward is −Z (usis.schema.json). Head position is the head
/// sample's `position` when present, else `playerOrigin`. Fires once per gaze; looking away re-arms it.
@MainActor
public final class LookAtDetector: EventDeriver {
    public var lockAngle: Double
    public var dwell: TimeInterval
    public var playerOrigin: Vector3

    /// Seconds of continuous gaze per entity; an entry exists only while the entity is inside the cone.
    private var gazeTime: [Entity.ID: TimeInterval] = [:]
    private var fired: Set<Entity.ID> = []

    /// `lockAngle` in radians (default 15°), `dwell` in seconds (default 0.5).
    public init(lockAngle: Double = 15 * .pi / 180, dwell: TimeInterval = 0.5, playerOrigin: Vector3 = .zero) {
        self.lockAngle = lockAngle
        self.dwell = dwell
        self.playerOrigin = playerOrigin
    }

    public func derive(from frame: InputFrame, deltaTime: TimeInterval, root: Entity) -> [GameEvent] {
        // No head, no orientation, or a stale head: freeze state, emit nothing.
        guard let head = frame.device(slot: .head), !head.stale, let orientation = head.orientation else {
            return []
        }
        let forward = Self.forward(of: orientation)
        let origin = head.position ?? playerOrigin

        var events: [GameEvent] = []
        var seen = Set<Entity.ID>()
        visit(root) { entity in
            guard entity.components[ScriptComponent.self] != nil else { return }
            seen.insert(entity.id)

            let p = entity.position(relativeTo: nil)
            let toEntity = Vector3(Double(p.x), Double(p.y), Double(p.z)) - origin
            let locked = Self.isWithin(lockAngle, forward: forward, toTarget: toEntity)

            guard locked else {
                gazeTime[entity.id] = nil
                fired.remove(entity.id)
                return
            }
            let total = (gazeTime[entity.id] ?? 0) + max(0, deltaTime)
            gazeTime[entity.id] = total
            if total >= dwell, fired.insert(entity.id).inserted {
                events.append(.lookAt(entity: entity.id))
            }
        }

        // Entities removed from the scene lose their timers.
        for id in gazeTime.keys where !seen.contains(id) { gazeTime[id] = nil }
        fired.formIntersection(seen)
        return events
    }

    /// −Z rotated by `q`.
    static func forward(of q: Quaternion) -> Vector3 {
        let n = q.normalized
        let r = n * Quaternion(0, 0, -1, 0) * n.inverse
        return Vector3(r.x, r.y, r.z).normalized
    }

    /// `acos(f · ŝ) < angle`. A target at the head position has no direction and is never locked.
    static func isWithin(_ angle: Double, forward: Vector3, toTarget: Vector3) -> Bool {
        let s = toTarget.normalized
        guard s != .zero else { return false }
        return acos(min(1, max(-1, forward.dot(s)))) < angle
    }

    private func visit(_ entity: Entity, _ body: (Entity) -> Void) {
        body(entity)
        for child in entity.children { visit(child, body) }
    }
}
