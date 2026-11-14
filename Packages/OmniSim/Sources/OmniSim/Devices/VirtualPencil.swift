import Foundation
import Synchronization
import OmniCore
import OmniInput

/// Simulated Apple Pencil, slot `stylus`. In contact it emits at 240 Hz with pressure 0–1 and barrel roll; hovering it
/// emits at 60 Hz with roll 0 (a real Pencil reports no roll while hovering; the `PencilState.roll` field is not optional).
/// Units follow `PencilState` today: `tip` and `hover` in meters, `roll` in radians (plan.md flags the real units as undecided).
// @unchecked Sendable: all mutable state lives behind a Mutex; the justification in VirtualDevice.swift applies.
public final class VirtualPencil: VirtualDevice, @unchecked Sendable {
    private struct PencilData {
        var inContact = false
        var tip = Vector3(0, 0, 0)
        var pressure = 0.0
        var roll = 0.0
        var hoverHeight = 0.0
        var hoverRng: SeededGenerator
    }

    private let pencil: Mutex<PencilData>

    public init(deviceId: String = "sim-pencil", noise: NoiseModel = .pencil, seed: UInt64 = 4) {
        pencil = Mutex(PencilData(hoverRng: SeededGenerator(seed: seed ^ 0xA5A5_A5A5_A5A5_A5A5)))
        super.init(
            deviceId: deviceId, kind: .pencil, slot: .stylus, channels: [.orientation, .pencil],
            noise: noise, seed: seed
        )
    }

    private static func finite(_ v: Double) -> Double { v.isFinite ? v : 0 }

    private static func finite(_ v: Vector3) -> Vector3 {
        Vector3(finite(v.x), finite(v.y), finite(v.z))
    }

    /// Puts the tip on the surface: pressure is clamped to 0–1 and hover is 0.
    public func touchDown(tip: Vector3, pressure: Double, roll: Double = 0) {
        pencil.withLock {
            $0.inContact = true
            $0.tip = Self.finite(tip)
            $0.pressure = min(1, max(0, Self.finite(pressure)))
            $0.roll = Self.finite(roll)
            $0.hoverHeight = 0
        }
    }

    /// Lifts the tip to `height` meters above the surface (negative values become 0); pressure and roll drop to 0.
    public func hover(tip: Vector3, height: Double) {
        pencil.withLock {
            $0.inContact = false
            $0.tip = Self.finite(tip)
            $0.pressure = 0
            $0.roll = 0
            $0.hoverHeight = max(0, Self.finite(height))
        }
    }

    public var isInContact: Bool { pencil.withLock { $0.inContact } }

    /// Gap to the next packet: contact uses the device's noise model (240 Hz), hover uses `NoiseModel.pencilHover` (60 Hz).
    public override func nextIntervalMs() -> Double {
        let hoverGap = pencil.withLock { s -> Double? in
            s.inContact ? nil : NoiseModel.pencilHover.nextIntervalMs(using: &s.hoverRng)
        }
        return hoverGap ?? super.nextIntervalMs()
    }

    public override func sampleChannels(
        orientation: Quaternion, position: Vector3?, rng: inout SeededGenerator
    ) -> UsisChannels {
        let state = pencil.withLock { s in
            PencilState(
                tip: s.tip, pressure: s.pressure, roll: s.inContact ? s.roll : 0,
                hover: s.inContact ? 0 : s.hoverHeight
            )
        }
        return UsisChannels(
            orientation: noise.perturb(orientation, using: &rng),
            position: position,
            pencil: state
        )
    }
}
