import Foundation
import OmniCore

/// Small deterministic generator (SplitMix64) so every simulated device can be driven by an injected seed.
/// Same seed, same sequence: tests and recordings are reproducible.
public struct SeededGenerator: RandomNumberGenerator, Sendable {
    private var state: UInt64

    public init(seed: UInt64) {
        state = seed
    }

    public mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

/// Per-device sample rate and noise parameters, roughly matching measured hardware (plan.md hardware probes,
/// 2026-11-14). Randomness always comes in as an argument; nothing here reads a clock or a global generator.
public struct NoiseModel: Equatable, Sendable {
    /// Nominal packet rate.
    public var sampleRateHz: Double
    /// Standard deviation of the gap between packets, ms (0 = perfectly steady).
    public var intervalJitterMs: Double
    /// Standard deviation of per-axis orientation noise, radians.
    public var orientationNoiseRad: Double
    /// Standard deviation of per-axis acceleration noise, m/s².
    public var accelNoise: Double
    /// Standard deviation of heart-rate noise, bpm.
    public var heartRateNoiseBpm: Double

    public init(
        sampleRateHz: Double,
        intervalJitterMs: Double = 0,
        orientationNoiseRad: Double = 0,
        accelNoise: Double = 0,
        heartRateNoiseBpm: Double = 0
    ) {
        self.sampleRateHz = sampleRateHz
        self.intervalJitterMs = max(0, intervalJitterMs)
        self.orientationNoiseRad = max(0, orientationNoiseRad)
        self.accelNoise = max(0, accelNoise)
        self.heartRateNoiseBpm = max(0, heartRateNoiseBpm)
    }

    /// Mean gap between packets in ms.
    public var nominalIntervalMs: Double {
        sampleRateHz > 0 ? 1000 / sampleRateHz : .infinity
    }

    /// AirPods: steady 50 Hz (20 ms p50/p95); noise while still: rotation sd ≤0.03 rad/s, accel sd ≤0.003 g.
    public static let airpods = NoiseModel(
        sampleRateHz: 50, intervalJitterMs: 1, orientationNoiseRad: 0.002, accelNoise: 0.003 * 9.81
    )

    /// Watch: sparse, 1–10 Hz; the plan.md probes did not measure it, so 5 Hz is the middle of the range.
    public static let watch = NoiseModel(
        sampleRateHz: 5, intervalJitterMs: 20, orientationNoiseRad: 0.01, accelNoise: 0.05, heartRateNoiseBpm: 1
    )

    /// Phone motion: 100 Hz with 10 ms intervals measured. Wi-Fi stalls are a transport effect, not modelled here.
    public static let phone = NoiseModel(
        sampleRateHz: 100, intervalJitterMs: 1, orientationNoiseRad: 0.002, accelNoise: 0.003 * 9.81
    )

    /// Pencil contact samples: 240 Hz (hover is 60 Hz, see `pencilHover`).
    public static let pencil = NoiseModel(sampleRateHz: 240, intervalJitterMs: 0.3)

    public static let pencilHover = NoiseModel(sampleRateHz: 60, intervalJitterMs: 1)

    /// Gap until the next packet: nominal interval plus Gaussian jitter, never below 10% of nominal.
    public func nextIntervalMs<G: RandomNumberGenerator>(using rng: inout G) -> Double {
        let nominal = nominalIntervalMs
        guard nominal.isFinite else { return nominal }
        return max(nominal * 0.1, nominal + Self.gaussian(using: &rng) * intervalJitterMs)
    }

    /// `q` rotated by a small random rotation; the result is always unit length (the validator tolerates 0.01).
    public func perturb<G: RandomNumberGenerator>(_ q: Quaternion, using rng: inout G) -> Quaternion {
        guard orientationNoiseRad > 0 else { return q.normalized }
        let hx = Self.gaussian(using: &rng) * orientationNoiseRad / 2
        let hy = Self.gaussian(using: &rng) * orientationNoiseRad / 2
        let hz = Self.gaussian(using: &rng) * orientationNoiseRad / 2
        return (q.normalized * Quaternion(hx, hy, hz, 1).normalized).normalized
    }

    public func perturbAccel<G: RandomNumberGenerator>(_ v: Vector3, using rng: inout G) -> Vector3 {
        guard accelNoise > 0 else { return v }
        return Vector3(
            v.x + Self.gaussian(using: &rng) * accelNoise,
            v.y + Self.gaussian(using: &rng) * accelNoise,
            v.z + Self.gaussian(using: &rng) * accelNoise
        )
    }

    /// Noisy heart rate, floored at 0 (the schema rejects negative values).
    public func perturbHeartRate<G: RandomNumberGenerator>(_ bpm: Double, using rng: inout G) -> Double {
        max(0, bpm + Self.gaussian(using: &rng) * heartRateNoiseBpm)
    }

    /// Standard normal sample (Box-Muller).
    static func gaussian<G: RandomNumberGenerator>(using rng: inout G) -> Double {
        let u1 = max(Double.random(in: 0..<1, using: &rng), 1e-12)
        let u2 = Double.random(in: 0..<1, using: &rng)
        return (-2 * log(u1)).squareRoot() * cos(2 * .pi * u2)
    }
}
