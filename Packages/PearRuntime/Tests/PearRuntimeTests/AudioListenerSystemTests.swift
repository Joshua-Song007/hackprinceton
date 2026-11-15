import Foundation
import Testing
import RealityKit
import PearCore
@testable import PearRuntime

@MainActor
struct AudioListenerSystemTests {
    private func frame(_ q: Quaternion?, position: Vector3? = nil, stale: Bool = false) -> InputFrame {
        InputFrame(timestamp: 0, devices: [
            DeviceSample(deviceId: "h", kind: .airpods, slot: .head, stale: stale, orientation: q, position: position)
        ])
    }

    @Test func makeListenerStartsAtOrigin() {
        #expect(AudioListenerSystem.makeListener().position(relativeTo: nil) == .zero)
    }

    @Test func followsHeadOrientationAndPosition() {
        let listener = AudioListenerSystem.makeListener()
        let h = Double.pi / 4 // 90° about +Y
        let q = Quaternion(0, sin(h), 0, cos(h))
        let updated = AudioListenerSystem.apply(frame: frame(q, position: Vector3(1, 2, 3)), listener: listener, playerOrigin: .zero)
        #expect(updated)
        let p = listener.position(relativeTo: nil)
        #expect(abs(p.x - 1) < 1e-5 && abs(p.y - 2) < 1e-5 && abs(p.z - 3) < 1e-5)
        // Facing −Z rotated 90° about +Y points along −X.
        let f = listener.orientation(relativeTo: nil).act(SIMD3<Float>(0, 0, -1))
        #expect(abs(f.x + 1) < 1e-5 && abs(f.z) < 1e-5)
    }

    @Test func usesPlayerOriginWhenHeadHasNoPosition() {
        let listener = AudioListenerSystem.makeListener()
        AudioListenerSystem.apply(frame: frame(.identity), listener: listener, playerOrigin: Vector3(0, 1.6, 2))
        let p = listener.position(relativeTo: nil)
        #expect(abs(p.x) < 1e-5 && abs(p.y - 1.6) < 1e-5 && abs(p.z - 2) < 1e-5)
    }

    @Test func staleOrMissingHeadLeavesListenerUnchanged() {
        let listener = AudioListenerSystem.makeListener()
        listener.setPosition([4, 5, 6], relativeTo: nil)
        #expect(!AudioListenerSystem.apply(frame: frame(.identity, stale: true), listener: listener, playerOrigin: .zero))
        #expect(!AudioListenerSystem.apply(frame: .empty, listener: listener, playerOrigin: .zero))
        #expect(!AudioListenerSystem.apply(frame: frame(nil), listener: listener, playerOrigin: .zero))
        #expect(listener.position(relativeTo: nil) == SIMD3<Float>(4, 5, 6))
    }
}
