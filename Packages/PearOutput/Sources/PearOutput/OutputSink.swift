import PearCore

/// Receives the commands the game sends back to the player: haptic pulses, audio cues, device-specific effects.
/// The live sink forwards them over the bridge; the simulator sink shows them on the virtual device.
///
/// Contract for implementations:
/// - Called once per frame from the frame loop with the commands drained from the runtime's `OutputQueue`.
/// - Synchronous and non-throwing: enqueue and return, never block the frame.
/// - Must be thread-safe (for example a `Mutex`-guarded queue). A `@MainActor` class cannot conform; a sink that touches
///   main-actor state queues the commands and lets its owner drain them on the main actor.
/// - `target` is a deviceId or a slot name; resolving it is the implementation's job.
/// - A command for an unknown target or a lost device is dropped, not reported to the caller; a sink may count drops.
/// - An empty array is a no-op.
public protocol OutputSink: AnyObject, Sendable {
    func send(_ commands: [OutputCommand])
}

extension OutputSink {
    public func send(_ command: OutputCommand) {
        send([command])
    }
}
