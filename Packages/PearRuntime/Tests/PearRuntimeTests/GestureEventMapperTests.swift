import Foundation
import Testing
import RealityKit
import PearCore
@testable import PearRuntime

@MainActor
struct GestureEventMapperTests {
    private func frame(_ devices: [DeviceSample]) -> InputFrame {
        InputFrame(timestamp: 0, devices: devices)
    }

    @Test(arguments: [GestureType.tap, .doubleTap, .flick, .squeeze, .pinch])
    func eachTypeMapsWithoutDir(type: GestureType) {
        let mapper = GestureEventMapper()
        let device = DeviceSample(deviceId: "w", kind: .watch, slot: .leftWrist, gestures: [GestureEvent(type: type)])
        let events = mapper.derive(from: frame([device]), deltaTime: 0.016, root: Entity())
        #expect(events == [.gesture(GestureEvent(type: type), slot: .leftWrist)])
    }

    @Test func dirIsPreserved() {
        let mapper = GestureEventMapper()
        let g = GestureEvent(type: .flick, dir: Vector3(1, 0, 0))
        let device = DeviceSample(deviceId: "p", kind: .phone, slot: .hand, gestures: [g])
        let events = mapper.derive(from: frame([device]), deltaTime: 0.016, root: Entity())
        #expect(events == [.gesture(g, slot: .hand)])
    }

    @Test func multipleDevicesAllMap() {
        let mapper = GestureEventMapper()
        let a = DeviceSample(deviceId: "a", kind: .watch, slot: .leftWrist, gestures: [GestureEvent(type: .tap)])
        let b = DeviceSample(deviceId: "b", kind: .phone, slot: .pocket, gestures: [GestureEvent(type: .pinch)])
        let events = mapper.derive(from: frame([a, b]), deltaTime: 0.016, root: Entity())
        #expect(events.count == 2)
    }

    @Test func staleDeviceEmitsNothing() {
        let mapper = GestureEventMapper()
        let device = DeviceSample(
            deviceId: "w", kind: .watch, slot: .leftWrist, stale: true, gestures: [GestureEvent(type: .tap)])
        #expect(mapper.derive(from: frame([device]), deltaTime: 0.016, root: Entity()).isEmpty)
    }

    @Test func noGesturesEmitsNothing() {
        let mapper = GestureEventMapper()
        let device = DeviceSample(deviceId: "w", kind: .watch, slot: .leftWrist)
        #expect(mapper.derive(from: frame([device]), deltaTime: 0.016, root: Entity()).isEmpty)
    }
}
