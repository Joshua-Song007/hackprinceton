import Foundation
import Synchronization
import OmniCore
import OmniOutput

/// `OutputSink` forwarding each `OutputCommand` to the live device(s) it addresses. `target` is a deviceId or a
/// slot name (a slot reaches every connected device in it). Commands for an unknown target, a lost device or a
/// failed send are dropped and counted; `send` never blocks the frame.
public final class BridgeOutputSink: OutputSink {
    private let source: BridgeInputSource
    private let dropped = Mutex(0)

    public init(source: BridgeInputSource) {
        self.source = source
    }

    /// Commands that reached no device.
    public var droppedCount: Int { dropped.withLock { $0 } }

    public func send(_ commands: [OutputCommand]) {
        for command in commands {
            let sessions = source.sessions(forTarget: command.target)
            var delivered = false
            for session in sessions where (try? session.send(command)) != nil {
                delivered = true
            }
            if !delivered { dropped.withLock { $0 += 1 } }
        }
    }
}
