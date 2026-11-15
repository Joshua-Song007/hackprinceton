import Foundation
import Testing
import PearCore
@testable import PearSim

struct RigTests {
    @Test func slotsMapToDeviceKinds() {
        #expect(RigSlotMap.kind(for: .head) == .airpods)
        #expect(RigSlotMap.kind(for: .leftWrist) == .watch)
        #expect(RigSlotMap.kind(for: .rightWrist) == .watch)
        #expect(RigSlotMap.kind(for: .hand) == .phone)
        #expect(RigSlotMap.kind(for: .pocket) == .phone)
        #expect(RigSlotMap.kind(for: .stylus) == .pencil)
    }

    @Test func madeDeviceMatchesSlotAndHasUniqueId() {
        var ids = Set<String>()
        for slot in Slot.allCases {
            let d = RigSlotMap.makeDevice(for: slot)
            #expect(d.descriptors[0].kind == RigSlotMap.kind(for: slot))
            if slot == .leftWrist || slot == .rightWrist || slot == .pocket || slot == .head {
                #expect(d.descriptors[0].slot == slot)
            }
            ids.insert(d.descriptors[0].deviceId)
        }
        #expect(ids.count == Slot.allCases.count)
    }

    @Test func entityNamesRoundTrip() {
        for slot in Slot.allCases {
            #expect(RigSlotMap.slot(forEntityName: RigSlotMap.entityName(for: slot)) == slot)
        }
        #expect(RigSlotMap.slot(forEntityName: "avatar-body") == nil)
        #expect(RigSlotMap.slot(forEntityName: "slot-bogus") == nil)
    }

    @Test func anglesGiveUnitQuaternionAndYawTurnsForward() {
        let q = GizmoMath.orientation(yaw: .pi / 2, pitch: 0, roll: 0)
        #expect(abs(q.norm - 1) < 1e-9)
        let f = GazeRaycaster.rotate(Vector3(0, 0, -1), by: q)
        // yaw +90° about +Y turns forward (−Z) to −X
        #expect(abs(f.x + 1) < 1e-9 && abs(f.z) < 1e-9)
        #expect(GizmoMath.orientation(yaw: .nan, pitch: .infinity, roll: 0).isApproximatelyEqual(to: .identity))
    }

    @Test func rotateAndTranslateCompose() {
        let q = GizmoMath.rotated(.identity, about: .y, radians: 0.5)
        #expect(q.isApproximatelyEqual(to: GizmoMath.rotation(about: .y, radians: 0.5)))
        #expect(GizmoMath.rotated(q, about: .x, radians: .nan) == q)
        let p = GizmoMath.translated(Vector3(1, 2, 3), along: .y, by: 0.5)
        #expect(p == Vector3(1, 2.5, 3))
        #expect(GizmoMath.translated(p, along: .x, by: .nan) == p)
    }

    @Test func controllerDrivesDevice() {
        let device = VirtualAirPods()
        let gizmo = GizmoController(device: device)
        gizmo.setAngles(yaw: 0.3, pitch: 0, roll: 0)
        #expect(device.targetOrientation.isApproximatelyEqual(to: GizmoMath.rotation(about: .y, radians: 0.3)))
        gizmo.translate(along: .x, by: 2)
        #expect(device.targetPosition == Vector3(2, 0, 0))
    }

    @Test func centreMouseLooksForward() {
        let g = GazeRaycaster()
        let r = g.ray(headPosition: Vector3(0, 1.7, 0), headOrientation: .identity, mouseX: 0.5, mouseY: 0.5, aspect: 1.5)
        #expect(abs(r.direction.x) < 1e-9 && abs(r.direction.y) < 1e-9 && abs(r.direction.z + 1) < 1e-9)
        #expect(r.origin == Vector3(0, 1.7, 0))
    }

    @Test func mouseOffsetsAimRightAndUp() {
        let g = GazeRaycaster()
        let right = g.ray(headPosition: .zero, headOrientation: .identity, mouseX: 1, mouseY: 0.5, aspect: 1)
        let up = g.ray(headPosition: .zero, headOrientation: .identity, mouseX: 0.5, mouseY: 0, aspect: 1)
        #expect(right.direction.x > 0 && abs(right.direction.length - 1) < 1e-9)
        #expect(up.direction.y > 0)
        // clamping and bad input never produce NaN
        let bad = g.ray(headPosition: .zero, headOrientation: .identity, mouseX: .nan, mouseY: 9, aspect: -1)
        #expect(bad.direction.length.isFinite)
    }

    @Test func clickQueuesPinchOnWatch() {
        let watch = VirtualWatch()
        let g = GazeRaycaster(pinchTarget: watch)
        let ray = g.ray(headPosition: .zero, headOrientation: .identity, mouseX: 0.5, mouseY: 0.5, aspect: 1)
        let event = g.click(along: ray)
        #expect(event.type == .pinch)
        let packet = watch.makePacket(hostNowMs: 0)
        #expect(packet.ch.gesture?.type == .pinch)
        #expect(watch.makePacket(hostNowMs: 20).ch.gesture == nil)
    }
}
