import Foundation
import OmniCore

/// Time-sorted samples of one channel, pruned by age and capped in size.
private struct Track<Value: Sendable>: Sendable {
    struct Entry: Sendable {
        var time: Double
        var value: Value
    }

    var entries: [Entry] = []

    mutating func insert(time: Double, value: Value, capacity: Int) {
        var lo = 0
        var hi = entries.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if entries[mid].time <= time { lo = mid + 1 } else { hi = mid }
        }
        entries.insert(Entry(time: time, value: value), at: lo)
        if entries.count > capacity {
            entries.removeFirst(entries.count - capacity)
        }
    }

    /// Drops entries older than `cutoff`, but always keeps the newest one at or before it so a bracket still exists.
    mutating func prune(before cutoff: Double) {
        var drop = 0
        while drop + 1 < entries.count && entries[drop + 1].time <= cutoff {
            drop += 1
        }
        if drop > 0 {
            entries.removeFirst(drop)
        }
    }

    /// Interpolates between the two entries bracketing `t`; holds the first entry before it and the last entry after it.
    func sample(at t: Double, blend: (Value, Value, Double) -> Value) -> Value? {
        guard let first = entries.first else { return nil }
        guard t > first.time else { return first.value }
        var lo = 0
        var hi = entries.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if entries[mid].time <= t { lo = mid + 1 } else { hi = mid }
        }
        let a = entries[lo - 1]
        guard lo < entries.count else { return a.value }
        let b = entries[lo]
        return blend(a.value, b.value, (t - a.time) / (b.time - a.time))
    }
}

private struct PendingEvent: Sendable {
    var time: Double
    var gestures: [GestureEvent]
    var touches: [TouchPoint]
}

/// Per-device buffer. Devices sample at different rates, so each channel is interpolated at `t_render = now − D`:
/// slerp for orientation, lerp for vectors, sample-and-hold plus EMA for heart rate. Gestures and touches are events,
/// delivered exactly once.
public struct JitterBuffer: Sendable {
    public var deviceId: String
    public var kind: DeviceKind
    public var slot: Slot
    public let retentionMs: Double
    public let capacity: Int
    public let emaTauMs: Double
    public private(set) var lastArrivalMs: Double?

    private var orientation = Track<Quaternion>()
    private var position = Track<Vector3>()
    private var accel = Track<Vector3>()
    private var pencil = Track<PencilState>()
    private var heartRate = Track<Double>()
    private var events: [PendingEvent] = []
    private var smoothedHeartRate: Double?
    private var lastSampleNowMs: Double?

    public init(
        deviceId: String,
        kind: DeviceKind,
        slot: Slot,
        retentionMs: Double = 1000,
        capacity: Int = 256,
        emaTauMs: Double = 1000
    ) {
        self.deviceId = deviceId
        self.kind = kind
        self.slot = slot
        self.retentionMs = retentionMs
        self.capacity = capacity
        self.emaTauMs = emaTauMs
    }

    /// Newest raw (uncalibrated) orientation, used for the calibration tap.
    public var latestOrientation: Quaternion? {
        orientation.entries.last?.value
    }

    var orientationSampleCount: Int { orientation.entries.count }

    /// `hostTimeMs` is the packet's timestamp converted to host time; `arrivalMs` is when it actually arrived.
    public mutating func push(hostTimeMs: Double, arrivalMs: Double, channels ch: UsisChannels) {
        lastArrivalMs = max(lastArrivalMs ?? arrivalMs, arrivalMs)
        if let v = ch.orientation { orientation.insert(time: hostTimeMs, value: v, capacity: capacity) }
        if let v = ch.position { position.insert(time: hostTimeMs, value: v, capacity: capacity) }
        if let v = ch.accel { accel.insert(time: hostTimeMs, value: v, capacity: capacity) }
        if let v = ch.pencil { pencil.insert(time: hostTimeMs, value: v, capacity: capacity) }
        if let v = ch.heartRate { heartRate.insert(time: hostTimeMs, value: v, capacity: capacity) }

        let touches = ch.touch ?? []
        let gestures = ch.gesture.map { [$0] } ?? []
        if !touches.isEmpty || !gestures.isEmpty {
            var lo = 0
            var hi = events.count
            while lo < hi {
                let mid = (lo + hi) / 2
                if events[mid].time <= hostTimeMs { lo = mid + 1 } else { hi = mid }
            }
            events.insert(PendingEvent(time: hostTimeMs, gestures: gestures, touches: touches), at: lo)
            if events.count > capacity {
                events.removeFirst(events.count - capacity)
            }
        }
    }

    public func isStale(nowMs: Double, staleAfterMs: Double = 500) -> Bool {
        guard let last = lastArrivalMs else { return true }
        return nowMs - last > staleAfterMs
    }

    /// A stale device (no packet for `staleAfterMs`, measured by arrival time) freezes its channels and emits no events.
    public mutating func sample(renderTimeMs: Double, nowMs: Double, staleAfterMs: Double = 500) -> DeviceSample {
        let stale = isStale(nowMs: nowMs, staleAfterMs: staleAfterMs)

        let cutoff = renderTimeMs - retentionMs
        orientation.prune(before: cutoff)
        position.prune(before: cutoff)
        accel.prune(before: cutoff)
        pencil.prune(before: cutoff)
        heartRate.prune(before: cutoff)

        var stalePrefix = 0
        while stalePrefix < events.count && events[stalePrefix].time < cutoff {
            stalePrefix += 1
        }
        if stalePrefix > 0 {
            events.removeFirst(stalePrefix)
        }

        var gestures: [GestureEvent] = []
        var touches: [TouchPoint] = []
        if !stale {
            var delivered = 0
            for event in events {
                guard event.time <= renderTimeMs else { break }
                gestures.append(contentsOf: event.gestures)
                touches.append(contentsOf: event.touches)
                delivered += 1
            }
            events.removeFirst(delivered)
        }

        let held = heartRate.sample(at: renderTimeMs) { a, _, _ in a }
        if let held {
            if smoothedHeartRate == nil {
                smoothedHeartRate = held
            } else if !stale, let previous = smoothedHeartRate, let last = lastSampleNowMs {
                let dt = max(0, nowMs - last)
                let alpha = 1 - exp(-dt / emaTauMs)
                smoothedHeartRate = previous + alpha * (held - previous)
            }
        }
        lastSampleNowMs = nowMs

        return DeviceSample(
            deviceId: deviceId,
            kind: kind,
            slot: slot,
            stale: stale,
            orientation: orientation.sample(at: renderTimeMs, blend: Quaternion.slerp),
            position: position.sample(at: renderTimeMs, blend: Vector3.lerp),
            accel: accel.sample(at: renderTimeMs, blend: Vector3.lerp),
            touches: touches,
            gestures: gestures,
            heartRate: smoothedHeartRate,
            pencil: pencil.sample(at: renderTimeMs) { a, b, u in
                PencilState(
                    tip: Vector3.lerp(a.tip, b.tip, u),
                    pressure: a.pressure + (b.pressure - a.pressure) * u,
                    roll: a.roll + (b.roll - a.roll) * u,
                    hover: a.hover + (b.hover - a.hover) * u
                )
            }
        )
    }
}
