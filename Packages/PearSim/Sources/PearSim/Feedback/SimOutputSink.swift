import Foundation
import Synchronization
import PearCore
import PearOutput

/// `OutputSink` for the simulator: haptic and audio commands are shown on the virtual device (pulse ring, vibration icon,
/// sound cone) by whoever installed a feedback handler on it.
/// `send` resolves each command's `target` (a deviceId, or a slot name such as "leftWrist") against the registered devices and
/// queues one entry per matching device behind a `Mutex`; it never blocks the frame. The rig calls `drain()` on the main actor
/// each frame, which hands every queued command to its device's feedback hook (`deliverFeedback`).
/// A command whose target matches no registered device is dropped and counted in `unknownTargetCount`.
public final class SimOutputSink: OutputSink {
    /// One command routed to one device.
    public struct Delivery: Sendable {
        public let deviceId: String
        public let command: OutputCommand
    }

    private struct Pending {
        let device: VirtualDevice
        let command: OutputCommand
    }

    private struct State {
        var devices: [VirtualDevice] = []
        var queue: [Pending] = []
        var unknown = 0
        var overflow = 0
    }

    /// Cap on queued entries so a rig that stops draining cannot grow memory without bound; the oldest are dropped.
    public static let maxQueued = 1024

    private let state = Mutex(State())

    public init() {}

    /// Makes a device addressable by its deviceId and its slot. Registering the same device twice is a no-op.
    public func register(_ device: VirtualDevice) {
        state.withLock { s in
            if !s.devices.contains(where: { $0 === device }) { s.devices.append(device) }
        }
    }

    /// Removes a device; commands already queued for it are discarded.
    public func unregister(_ device: VirtualDevice) {
        state.withLock { s in
            s.devices.removeAll { $0 === device }
            s.queue.removeAll { $0.device === device }
        }
    }

    /// Commands dropped because no registered device matched the target.
    public var unknownTargetCount: Int { state.withLock { $0.unknown } }

    /// Entries dropped because the queue was full.
    public var overflowCount: Int { state.withLock { $0.overflow } }

    /// Entries waiting for the next `drain()`.
    public var pendingCount: Int { state.withLock { $0.queue.count } }

    public func send(_ commands: [OutputCommand]) {
        guard !commands.isEmpty else { return }
        state.withLock { s in
            for command in commands {
                let matches = s.devices.filter { device in
                    guard let d = device.descriptors.first else { return false }
                    return d.deviceId == command.target || d.slot.rawValue == command.target
                }
                if matches.isEmpty {
                    s.unknown += 1
                    continue
                }
                for device in matches { s.queue.append(Pending(device: device, command: command)) }
            }
            let excess = s.queue.count - Self.maxQueued
            if excess > 0 {
                s.queue.removeFirst(excess)
                s.overflow += excess
            }
        }
    }

    /// Delivers every queued command to its device's feedback hook, in send order, and returns what was delivered.
    /// Call on the main actor once per frame. Hooks run outside the lock, so a hook may call back into the sink.
    @discardableResult
    public func drain() -> [Delivery] {
        let pending = state.withLock { s -> [Pending] in
            let p = s.queue
            s.queue.removeAll()
            return p
        }
        var out: [Delivery] = []
        out.reserveCapacity(pending.count)
        for p in pending {
            p.device.deliverFeedback(p.command)
            out.append(Delivery(deviceId: p.device.descriptors.first?.deviceId ?? "", command: p.command))
        }
        return out
    }
}
