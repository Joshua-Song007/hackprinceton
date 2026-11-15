import Foundation
import PearCore
import RealityKit
import simd

/// A device position that can enter trigger volumes, in world space.
public struct TriggerProbe: Equatable, Sendable {
    public var slot: Slot
    public var position: SIMD3<Float>

    public init(slot: Slot, position: SIMD3<Float>) {
        self.slot = slot
        self.position = position
    }
}

/// Resolves trigger overlaps. An ECS-style system called by `SceneRunner` each step rather than a registered
/// `RealityKit.System`, so it runs at a fixed point in the frame order and works without a live scene.
@MainActor
public enum TriggerSystem {
    /// One probe per slot: the first non-stale device in that slot that reports a `position`.
    /// A stale or position-less device yields no probe, so its occupancy is left unchanged.
    public static func probes(from frame: InputFrame) -> [TriggerProbe] {
        var seen = Set<Slot>()
        var result: [TriggerProbe] = []
        for device in frame.devices where !device.stale {
            guard let p = device.position, seen.insert(device.slot).inserted else { continue }
            result.append(TriggerProbe(slot: device.slot, position: SIMD3(Float(p.x), Float(p.y), Float(p.z))))
        }
        return result.sorted { $0.slot.rawValue < $1.slot.rawValue }
    }

    /// Updates every trigger's occupants, calls its `onEnter` / `onExit`, and returns the matching `GameEvent`s.
    /// Order: entities in tree order; within one trigger, exits then enters, each by slot name.
    public static func resolve(root: Entity, probes: [TriggerProbe]) -> [GameEvent] {
        var events: [GameEvent] = []
        visit(root) { entity in
            guard var trigger = entity.components[TriggerComponent.self] else { return }

            let toLocal = entity.transformMatrix(relativeTo: nil).inverse
            var inside = Set<Slot>()
            var observed = Set<Slot>()
            for probe in probes where trigger.probeSlots.contains(probe.slot) {
                observed.insert(probe.slot)
                let local = toLocal * SIMD4<Float>(probe.position, 1)
                if contains(trigger.shape, SIMD3(local.x, local.y, local.z)) {
                    inside.insert(probe.slot)
                }
            }

            let before = trigger.occupants
            let removedFromSlots = before.subtracting(trigger.probeSlots)
            let left = before.intersection(observed).subtracting(inside).union(removedFromSlots)
            let entered = inside.subtracting(before)
            guard !left.isEmpty || !entered.isEmpty else { return }

            trigger.occupants = before.subtracting(left).union(entered)
            entity.components.set(trigger)

            for slot in left.sorted(by: { $0.rawValue < $1.rawValue }) {
                trigger.onExit?(entity, slot)
                events.append(.triggerExited(trigger: entity.id, probe: slot))
            }
            for slot in entered.sorted(by: { $0.rawValue < $1.rawValue }) {
                trigger.onEnter?(entity, slot)
                events.append(.triggerEntered(trigger: entity.id, probe: slot))
            }
        }
        return events
    }

    /// Boundary counts as inside.
    static func contains(_ shape: TriggerComponent.Shape, _ local: SIMD3<Float>) -> Bool {
        switch shape {
        case .sphere(let radius):
            return simd_length(local) <= radius
        case .box(let size):
            let half = size / 2
            return abs(local.x) <= half.x && abs(local.y) <= half.y && abs(local.z) <= half.z
        }
    }

    private static func visit(_ entity: Entity, _ body: (Entity) -> Void) {
        body(entity)
        for child in entity.children {
            visit(child, body)
        }
    }
}
