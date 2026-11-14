import Foundation
import OmniCore
import OmniInput

/// Simulated AirPods: head orientation only, slot `head`, ~50 Hz. Real AirPods report no position, so a
/// `targetPosition` set on this device is never sent.
// @unchecked Sendable: all mutable state lives behind a Mutex; the justification in VirtualDevice.swift applies.
public final class VirtualAirPods:VirtualDevice, @unchecked Sendable {
    public init(deviceId: String = "sim-airpods", noise: NoiseModel = .airpods, seed: UInt64 = 1) {
        super.init(
            deviceId: deviceId, kind: .airpods, slot: .head, channels: [.orientation], noise: noise, seed: seed
        )
    }

    public override func sampleChannels(
        orientation: Quaternion, position: Vector3?, rng: inout SeededGenerator
    ) -> UsisChannels {
        UsisChannels(orientation: noise.perturb(orientation, using: &rng))
    }
}
