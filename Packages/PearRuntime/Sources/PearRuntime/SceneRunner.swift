import Foundation
import PearCore
import RealityKit

/// Runs the scene once per frame from an `InputFrame` snapshot. It never reads sockets, device APIs or simulator state.
@MainActor
public final class SceneRunner {
    private static let componentsRegistered: Void = {
        TriggerComponent.registerComponent()
        AudioEmitterComponent.registerComponent()
        ScriptComponent.registerComponent()
    }()

    public let root: Entity
    /// Commands produced this frame; the caller drains it (the runtime never sees a sink).
    public let outputQueue = OutputQueue()
    public weak var dispatcher: (any EventDispatcher)?
    public var derivers: [any EventDeriver] = []

    public init(root: Entity = Entity()) {
        _ = Self.componentsRegistered
        self.root = root
    }

    /// Order: derive events → dispatch them → resolve triggers → dispatch trigger events.
    public func step(frame: InputFrame, deltaTime: TimeInterval) {
        var derived: [GameEvent] = []
        for deriver in derivers {
            derived.append(contentsOf: deriver.derive(from: frame, deltaTime: deltaTime, root: root))
        }
        dispatch(derived)

        let triggerEvents = TriggerSystem.resolve(root: root, probes: TriggerSystem.probes(from: frame))
        dispatch(triggerEvents)
    }

    /// Targeted events go to that entity only (skipped if it is gone or has no script); the rest go to every scripted entity.
    private func dispatch(_ events: [GameEvent]) {
        guard !events.isEmpty, let dispatcher else { return }

        var byID: [Entity.ID: Entity] = [:]
        var scripted: [Entity] = []
        collect(root, into: &byID, scripted: &scripted)

        for event in events {
            if let id = event.targetEntityID {
                if let entity = byID[id], entity.components[ScriptComponent.self] != nil {
                    dispatcher.dispatch(event, to: entity)
                }
            } else {
                for entity in scripted {
                    dispatcher.dispatch(event, to: entity)
                }
            }
        }
    }

    private func collect(_ entity: Entity, into byID: inout [Entity.ID: Entity], scripted: inout [Entity]) {
        byID[entity.id] = entity
        if entity.components[ScriptComponent.self] != nil {
            scripted.append(entity)
        }
        for child in entity.children {
            collect(child, into: &byID, scripted: &scripted)
        }
    }
}
