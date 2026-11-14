import Foundation
import Synchronization
import OmniCore

/// Writes packets as `.usis.jsonl`: one compact JSON packet per line.
/// Output goes to an injected `write` closure that receives each line including its trailing newline,
/// so tests collect lines in memory and Studio passes `fileWriter(url:)`.
public final class UsisRecorder: Sendable {
    private struct State {
        var count = 0
        var isRecording = true
    }

    private let write: @Sendable (String) -> Void
    private let encoder: JSONEncoder
    private let state = Mutex(State())

    public init(write: @escaping @Sendable (String) -> Void) {
        self.write = write
        let encoder = JSONEncoder()
        // Sorted keys keep recordings deterministic and diffable.
        encoder.outputFormatting = [.sortedKeys]
        self.encoder = encoder
    }

    /// Number of packets written so far.
    public var packetCount: Int { state.withLock { $0.count } }

    /// Writes one packet. Returns false when recording is stopped or the packet could not be encoded.
    /// Calls are serialized, so lines never interleave when several devices record at once.
    @discardableResult
    public func record(_ packet: UsisPacket) -> Bool {
        guard let data = try? encoder.encode(packet), let line = String(data: data, encoding: .utf8) else {
            return false
        }
        return state.withLock { s in
            guard s.isRecording else { return false }
            write(line + "\n")
            s.count += 1
            return true
        }
    }

    /// Later `record` calls are ignored.
    public func stop() {
        state.withLock { $0.isRecording = false }
    }

    /// A `write` closure appending to the file at `url` (created or truncated). Throws if the file cannot be opened.
    public static func fileWriter(url: URL) throws -> @Sendable (String) -> Void {
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        let handle = try FileHandle(forWritingTo: url)
        let box = Mutex(handle)
        return { line in
            box.withLock { h in
                try? h.write(contentsOf: Data(line.utf8))
            }
        }
    }
}
