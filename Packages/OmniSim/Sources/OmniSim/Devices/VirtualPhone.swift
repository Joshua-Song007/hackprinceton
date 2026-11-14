import Foundation
import Synchronization
import OmniCore
import OmniInput

/// Simulated iPhone: orientation, acceleration (m/s², device frame in Omni axes) and touch, slot `pocket` by default, 100 Hz.
/// Touch events are queued and delivered in the next packet(s); coordinates are clamped to 0–1.
// @unchecked Sendable: all mutable state lives behind a Mutex; the justification in VirtualDevice.swift applies.
public final class VirtualPhone: VirtualDevice, @unchecked Sendable {
    private struct PhoneState {
        var accel = Vector3(0, 0, 0)
        var touches: [TouchPoint] = []
    }

    static let maxQueuedTouches = 64

    private let phone = Mutex(PhoneState())

    public init(
        deviceId: String = "sim-phone", slot: Slot = .pocket, noise: NoiseModel = .phone, seed: UInt64 = 3
    ) {
        super.init(
            deviceId: deviceId, kind: .phone, slot: slot, channels: [.orientation, .accel, .touch],
            noise: noise, seed: seed
        )
    }

    /// Acceleration the phone should report before noise, m/s². Non-finite components become 0.
    public var targetAccel: Vector3 {
        get { phone.withLock { $0.accel } }
        set {
            phone.withLock {
                $0.accel = Vector3(Self.finite(newValue.x), Self.finite(newValue.y), Self.finite(newValue.z))
            }
        }
    }

    private static func finite(_ v: Double) -> Double { v.isFinite ? v : 0 }

    private static func unit(_ v: Double) -> Double { v.isFinite ? min(1, max(0, v)) : 0 }

    /// Queues one touch event (screen coordinates normalized 0–1, clamped). A `moved` event replaces a still-pending
    /// `moved` for the same finger, so slow consumers see the latest position while began and ended are never lost.
    public func sendTouch(id: Int, x: Double, y: Double, phase: TouchPhase) {
        let point = TouchPoint(id: id, x: Self.unit(x), y: Self.unit(y), phase: phase)
        phone.withLock { s in
            if phase == .moved, let i = s.touches.lastIndex(where: { $0.id == id }), s.touches[i].phase == .moved {
                s.touches[i] = point
                return
            }
            if s.touches.count >= Self.maxQueuedTouches { s.touches.removeFirst() }
            s.touches.append(point)
        }
    }

    public override func sampleChannels(
        orientation: Quaternion, position: Vector3?, rng: inout SeededGenerator
    ) -> UsisChannels {
        let (accel, touches) = phone.withLock { s -> (Vector3, [TouchPoint]?) in
            let pending = s.touches
            s.touches.removeAll()
            return (s.accel, pending.isEmpty ? nil : pending)
        }
        return UsisChannels(
            orientation: noise.perturb(orientation, using: &rng),
            position: position,
            accel: noise.perturbAccel(accel, using: &rng),
            touch: touches
        )
    }
}
