import Foundation
import Synchronization
import Testing
import RealityKit
import OmniCore
import OmniInput
@testable import OmniRuntime

private final class FakeClock: Sendable {
    private let value = Mutex(0.0)
    func now() -> Double { value.withLock { $0 } }
    func set(_ t: Double) { value.withLock { $0 = t } }
}

private struct Contact: Equatable {
    var trigger: String
    var slot: Slot
}

private struct Delivery: Equatable {
    var event: GameEvent
    var entity: String
}

@MainActor
private final class RecordingDispatcher: EventDispatcher {
    var deliveries: [Delivery] = []
    func dispatch(_ event: GameEvent, to entity: Entity) {
        deliveries.append(Delivery(event: event, entity: entity.name))
    }
}

@MainActor
private final class StubDeriver: EventDeriver {
    var events: [GameEvent] = []
    var calls = 0
    func derive(from frame: InputFrame, deltaTime: TimeInterval, root: Entity) -> [GameEvent] {
        calls += 1
        return events
    }
}

/// A hard-coded USIS packet: a headset reports its head position 2 m to the right.
private let hardCodedPacket = """
{"v":1,"deviceId":"headset-1","kind":"headset","slot":"head","source":"sim","t":0,"seq":0,"ch":{"position":[2,0,0]}}
"""

@MainActor
private final class Rig {
    let clock: FakeClock
    let pipeline: InputPipeline
    let runner = SceneRunner()
    let dispatcher = RecordingDispatcher()
    var enters: [Contact] = []
    var exits: [Contact] = []
    private var seq: [String: Int] = [:]

    init() {
        let clock = FakeClock()
        self.clock = clock
        self.pipeline = InputPipeline(clock: { clock.now() })
        runner.dispatcher = dispatcher
    }

    @discardableResult
    func addTrigger(
        _ name: String,
        at position: SIMD3<Float> = .zero,
        shape: TriggerComponent.Shape = .sphere(radius: 1),
        probeSlots: Set<Slot> = [.head],
        scripted: Bool = false,
        parent: Entity? = nil
    ) -> Entity {
        let entity = Entity()
        entity.name = name
        entity.position = position
        entity.components.set(TriggerComponent(
            shape: shape,
            probeSlots: probeSlots,
            onEnter: { [weak self] trigger, probe in self?.enters.append(Contact(trigger: trigger.name, slot: probe)) },
            onExit: { [weak self] trigger, probe in self?.exits.append(Contact(trigger: trigger.name, slot: probe)) }
        ))
        if scripted {
            entity.components.set(ScriptComponent(scriptName: name))
        }
        (parent ?? runner.root).addChild(entity)
        return entity
    }

    @discardableResult
    func addScripted(_ name: String) -> Entity {
        let entity = Entity()
        entity.name = name
        entity.components.set(ScriptComponent(scriptName: name))
        runner.root.addChild(entity)
        return entity
    }

    func place(_ id: String, slot: Slot = .head, kind: DeviceKind = .headset, at p: Vector3, t: Double) {
        let n = seq[id, default: 0]
        seq[id] = n + 1
        clock.set(t)
        pipeline.ingest(UsisPacket(
            deviceId: id, kind: kind, slot: slot, source: .sim, t: Int64(t), seq: n,
            ch: UsisChannels(position: p)
        ))
    }

    func step(at now: Double) {
        runner.step(frame: pipeline.frame(at: now), deltaTime: 1.0 / 60)
    }

    func move(_ id: String, slot: Slot = .head, kind: DeviceKind = .headset, to p: Vector3, at t: Double) {
        place(id, slot: slot, kind: kind, at: p, t: t)
        step(at: t + 100)
    }
}

@MainActor
@Suite struct SceneRunnerTriggerTests {
    // MARK: Phase 1 exit test

    @Test func hardCodedPacketFiresTheTrigger() {
        let rig = Rig()
        rig.addTrigger("zone", at: [2, 0, 0])
        rig.clock.set(0)
        rig.pipeline.ingest(json: Data(hardCodedPacket.utf8))
        rig.step(at: 100)

        #expect(rig.enters == [Contact(trigger: "zone", slot: .head)])
        #expect(rig.exits.isEmpty)
    }

    // MARK: Enter / exit

    @Test func stayingInsideDoesNotRefireAndLeavingFiresExitOnce() {
        let rig = Rig()
        rig.addTrigger("zone", at: [2, 0, 0])
        rig.move("hs", to: Vector3(2, 0, 0), at: 0)
        rig.move("hs", to: Vector3(2.5, 0, 0), at: 1000)
        #expect(rig.enters.count == 1)
        #expect(rig.exits.isEmpty)

        rig.move("hs", to: Vector3(5, 0, 0), at: 2000)
        rig.step(at: 2150)
        #expect(rig.enters.count == 1)
        #expect(rig.exits == [Contact(trigger: "zone", slot: .head)])
    }

    @Test func packetOutsideTheVolumeFiresNothing() {
        let rig = Rig()
        rig.addTrigger("zone", at: [2, 0, 0])
        rig.move("hs", to: Vector3(5, 0, 0), at: 0)
        #expect(rig.enters.isEmpty && rig.exits.isEmpty)
    }

    @Test func boundaryCountsAsInside() {
        let rig = Rig()
        rig.addTrigger("zone", at: [2, 0, 0], shape: .sphere(radius: 1))
        rig.move("hs", to: Vector3(3, 0, 0), at: 0)
        #expect(rig.enters.count == 1)
    }

    // MARK: Probe slots

    @Test func onlyAllowedSlotsEnterATrigger() {
        let rig = Rig()
        rig.addTrigger("headOnly", at: [2, 0, 0])
        rig.addTrigger("handOnly", at: [2, 0, 0], probeSlots: [.hand])
        rig.move("phone", slot: .hand, kind: .phone, to: Vector3(2, 0, 0), at: 0)
        #expect(rig.enters == [Contact(trigger: "handOnly", slot: .hand)])
    }

    @Test func severalProbesAreTrackedIndependently() {
        let rig = Rig()
        let zone = rig.addTrigger("zone", at: [2, 0, 0], probeSlots: [.head, .hand])
        rig.place("hs", at: Vector3(2, 0, 0), t: 0)
        rig.place("phone", slot: .hand, kind: .phone, at: Vector3(2, 0, 0), t: 0)
        rig.step(at: 100)
        #expect(rig.enters == [Contact(trigger: "zone", slot: .hand), Contact(trigger: "zone", slot: .head)])

        rig.move("hs", to: Vector3(9, 0, 0), at: 50)
        rig.step(at: 160)
        #expect(rig.exits == [Contact(trigger: "zone", slot: .head)])
        #expect(zone.components[TriggerComponent.self]?.occupants == [.hand])
    }

    @Test func narrowingProbeSlotsWhileOccupiedFiresExit() {
        let rig = Rig()
        let zone = rig.addTrigger("zone", at: [2, 0, 0])
        rig.move("hs", to: Vector3(2, 0, 0), at: 0)
        #expect(rig.enters.count == 1)

        zone.components[TriggerComponent.self]?.probeSlots = [.hand]
        rig.step(at: 200)
        #expect(rig.exits == [Contact(trigger: "zone", slot: .head)])
        #expect(zone.components[TriggerComponent.self]?.occupants.isEmpty == true)
    }

    @Test func staleProbeFreezesOccupancy() {
        let rig = Rig()
        let zone = rig.addTrigger("zone", at: [2, 0, 0])
        rig.move("hs", to: Vector3(2, 0, 0), at: 0)
        rig.step(at: 2000) // no packet for 2 s: the device is stale
        #expect(rig.exits.isEmpty)
        #expect(zone.components[TriggerComponent.self]?.occupants == [.head])
    }

    // MARK: Volumes and transforms

    @Test func boxVolumeFollowsTheEntitysRotation() {
        let rig = Rig()
        // 4 m long along local X, turned 90° about Y so it runs along world Z
        let beam = rig.addTrigger("beam", shape: .box(size: [4, 1, 1]))
        beam.orientation = simd_quatf(angle: .pi / 2, axis: [0, 1, 0])

        rig.move("hs", to: Vector3(1.5, 0, 0), at: 0)
        #expect(rig.enters.isEmpty)
        rig.move("hs", to: Vector3(0, 0, 1.5), at: 1000)
        #expect(rig.enters == [Contact(trigger: "beam", slot: .head)])
    }

    @Test func triggerNestedUnderAMovedParentUsesWorldPosition() {
        let rig = Rig()
        let parent = Entity()
        parent.position = [10, 0, 0]
        rig.runner.root.addChild(parent)
        rig.addTrigger("zone", at: [1, 0, 0], shape: .sphere(radius: 0.5), parent: parent)

        rig.move("hs", to: Vector3(1, 0, 0), at: 0) // local position, not world
        #expect(rig.enters.isEmpty)
        rig.move("hs", to: Vector3(11, 0, 0), at: 1000)
        #expect(rig.enters.count == 1)
    }

    // MARK: Probes

    @Test func probesSkipStaleAndPositionlessDevicesAndKeepOnePerSlot() {
        let frame = InputFrame(timestamp: 0, devices: [
            DeviceSample(deviceId: "a", kind: .headset, slot: .head, position: Vector3(1, 2, 3)),
            DeviceSample(deviceId: "b", kind: .headset, slot: .head, position: Vector3(9, 9, 9)),
            DeviceSample(deviceId: "c", kind: .phone, slot: .hand, stale: true, position: Vector3(4, 4, 4)),
            DeviceSample(deviceId: "d", kind: .airpods, slot: .pocket),
            DeviceSample(deviceId: "e", kind: .phone, slot: .leftWrist, position: Vector3(0, 1, 0)),
        ])
        let probes = TriggerSystem.probes(from: frame)
        #expect(probes == [
            TriggerProbe(slot: .head, position: [1, 2, 3]),
            TriggerProbe(slot: .leftWrist, position: [0, 1, 0]),
        ])
    }

    // MARK: Events to scripts

    @Test func broadcastEventsReachEveryScriptedEntityAndNoOther() {
        let rig = Rig()
        rig.addScripted("A")
        rig.addScripted("B")
        let plain = Entity()
        plain.name = "plain"
        rig.runner.root.addChild(plain)

        let deriver = StubDeriver()
        let tap = GameEvent.gesture(GestureEvent(type: .tap), slot: .hand)
        deriver.events = [tap]
        rig.runner.derivers = [deriver]
        rig.step(at: 100)

        #expect(deriver.calls == 1)
        #expect(rig.dispatcher.deliveries == [Delivery(event: tap, entity: "A"), Delivery(event: tap, entity: "B")])
    }

    @Test func targetedEventsReachOnlyThatEntity() {
        let rig = Rig()
        rig.addScripted("A")
        let b = rig.addScripted("B")
        let plain = Entity()
        plain.name = "plain"
        rig.runner.root.addChild(plain)

        let deriver = StubDeriver()
        deriver.events = [.lookAt(entity: b.id), .lookAt(entity: plain.id), .lookAt(entity: .max)]
        rig.runner.derivers = [deriver]
        rig.step(at: 100)

        #expect(rig.dispatcher.deliveries == [Delivery(event: .lookAt(entity: b.id), entity: "B")])
    }

    @Test func derivedEventsAreDispatchedBeforeTriggerEvents() {
        let rig = Rig()
        let zone = rig.addTrigger("zone", at: [2, 0, 0], scripted: true)
        let deriver = StubDeriver()
        let tap = GameEvent.gesture(GestureEvent(type: .tap), slot: .hand)
        deriver.events = [tap]
        rig.runner.derivers = [deriver]

        rig.move("hs", to: Vector3(2, 0, 0), at: 0)
        #expect(rig.dispatcher.deliveries == [
            Delivery(event: tap, entity: "zone"),
            Delivery(event: .triggerEntered(trigger: zone.id, probe: .head), entity: "zone"),
        ])
    }

    @Test func triggerEventsReachOnlyTheTriggersOwnScriptInTheSameStep() {
        let rig = Rig()
        let zone = rig.addTrigger("zone", at: [2, 0, 0], scripted: true)
        rig.addScripted("other")

        rig.move("hs", to: Vector3(2, 0, 0), at: 0)
        #expect(rig.dispatcher.deliveries == [
            Delivery(event: .triggerEntered(trigger: zone.id, probe: .head), entity: "zone"),
        ])

        rig.move("hs", to: Vector3(9, 0, 0), at: 1000)
        #expect(rig.dispatcher.deliveries.last == Delivery(event: .triggerExited(trigger: zone.id, probe: .head), entity: "zone"))
        #expect(rig.dispatcher.deliveries.count == 2)
    }

    @Test func triggerWithoutAScriptStillCallsItsCallbacksButDispatchesNothing() {
        let rig = Rig()
        rig.addTrigger("zone", at: [2, 0, 0])
        rig.addScripted("other")
        rig.move("hs", to: Vector3(2, 0, 0), at: 0)
        #expect(rig.enters.count == 1)
        #expect(rig.dispatcher.deliveries.isEmpty)
    }

    // MARK: Output queue and setup

    @Test func outputQueueKeepsOrderAndDrainEmptiesIt() {
        let queue = OutputQueue()
        #expect(queue.isEmpty)
        let a = OutputCommand(target: "head", type: .haptic, pattern: "pulse", intensity: 0.5, durationMs: 100)
        let b = OutputCommand(target: "leftWrist", type: .audio, pattern: "ping", intensity: 1, durationMs: 50)
        queue.enqueue(a)
        queue.enqueue(b)
        #expect(!queue.isEmpty)
        #expect(queue.drain() == [a, b])
        #expect(queue.isEmpty)
        #expect(queue.drain().isEmpty)
    }

    @Test func creatingSeveralRunnersRegistersComponentsOnlyOnce() {
        _ = SceneRunner()
        _ = SceneRunner()
        let runner = SceneRunner()
        #expect(runner.root.children.isEmpty)
        #expect(runner.outputQueue.isEmpty)
    }
}
