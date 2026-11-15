import PearCore

/// Collects the `OutputCommand`s produced during a frame (by scripts and the runtime). The caller drains it once at the
/// end of the frame and hands the commands to the active sink; the runtime itself never sees a sink.
@MainActor
public final class OutputQueue {
    private var pending: [OutputCommand] = []

    public init() {}

    public var isEmpty: Bool { pending.isEmpty }

    public func enqueue(_ command: OutputCommand) {
        pending.append(command)
    }

    /// Returns everything queued, in order, and empties the queue.
    public func drain() -> [OutputCommand] {
        defer { pending.removeAll() }
        return pending
    }
}
