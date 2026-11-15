import Foundation

public enum HostClock {
    /// Monotonic host time in milliseconds (immune to wall-clock jumps).
    public static func nowMs() -> Double {
        ProcessInfo.processInfo.systemUptime * 1000
    }
}

/// Estimates `host = device + offset` from ping exchanges: `offset = t_host − (t_send + rtt/2)`.
/// Asymmetric path delay makes the estimate off by at most rtt/2.
public struct ClockSync: Sendable {
    public static let maxSamples = 8
    public static let windowMs = 30_000.0
    public static let resyncIntervalMs = 5_000.0

    private struct Sample: Sendable {
        var rttMs: Double
        var offsetMs: Double
        var hostMs: Double
    }

    private var samples: [Sample] = []
    private var anchorOffsetMs: Double?

    public init() {}

    public var isSynced: Bool { !samples.isEmpty }
    public var hasAnchor: Bool { anchorOffsetMs != nil }

    /// Offset of the lowest-rtt recent sample (newest wins ties); before any ping, the anchor offset, else 0.
    public var offsetMs: Double {
        var best: Sample?
        for s in samples where best == nil || s.rttMs <= best!.rttMs {
            best = s
        }
        return best?.offsetMs ?? anchorOffsetMs ?? 0
    }

    public var bestRttMs: Double? {
        samples.map(\.rttMs).min()
    }

    public mutating func addSample(tSend: Double, tHost: Double, tRecv: Double) {
        let rtt = tRecv - tSend
        guard rtt >= 0, rtt.isFinite, tHost.isFinite else { return }
        samples.append(Sample(rttMs: rtt, offsetMs: tHost - (tSend + rtt / 2), hostMs: tHost))
        let newest = samples.map(\.hostMs).max() ?? tHost
        samples.removeAll { newest - $0.hostMs > Self.windowMs }
        if samples.count > Self.maxSamples {
            samples.removeFirst(samples.count - Self.maxSamples)
        }
        anchorOffsetMs = nil
    }

    /// Fallback before the first ping: align the first packet with its arrival. The offset then includes the first packet's
    /// latency, so later packets can map slightly ahead of arrival and the latency stat can go negative.
    public mutating func anchor(deviceMs: Double, hostMs: Double) {
        guard samples.isEmpty else { return }
        anchorOffsetMs = hostMs - deviceMs
    }

    public func toHost(_ deviceMs: Double) -> Double {
        deviceMs + offsetMs
    }

    public func needsResync(nowMs: Double) -> Bool {
        guard let newest = samples.map(\.hostMs).max() else { return true }
        return nowMs - newest > Self.resyncIntervalMs
    }
}
