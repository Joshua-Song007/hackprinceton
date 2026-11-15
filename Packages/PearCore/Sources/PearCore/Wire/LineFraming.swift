import Foundation

/// Newline-delimited framing over a byte stream. Pure buffer split/join: feed it bytes as they
/// arrive and it returns the complete lines. A line longer than `maxLineLength` is dropped
/// (including the rest of it as it arrives) and counted in `oversizedCount`.
public struct LineFraming: Sendable {
    public static let defaultMaxLineLength = 64 * 1024

    public let maxLineLength: Int
    /// Number of oversized lines discarded so far.
    public private(set) var oversizedCount = 0

    private var buffer = Data()
    private var discarding = false

    public init(maxLineLength: Int = LineFraming.defaultMaxLineLength) {
        self.maxLineLength = max(1, maxLineLength)
    }

    /// Appends received bytes and returns every complete line (without the newline). Empty lines are skipped.
    public mutating func append(_ bytes: Data) -> [Data] {
        var lines: [Data] = []
        for byte in bytes {
            if byte == 0x0A {
                if discarding {
                    discarding = false
                } else if !buffer.isEmpty {
                    lines.append(buffer)
                }
                buffer.removeAll(keepingCapacity: true)
            } else if !discarding {
                if buffer.count >= maxLineLength {
                    discarding = true
                    oversizedCount += 1
                    buffer.removeAll(keepingCapacity: true)
                } else {
                    buffer.append(byte)
                }
            }
        }
        return lines
    }

    /// Bytes buffered for an incomplete line.
    public var pendingByteCount: Int { buffer.count }

    /// Appends the newline terminator to one message's bytes.
    public static func frame(_ message: Data) -> Data {
        var out = message
        out.append(0x0A)
        return out
    }

    /// Encodes a wire message as one framed line.
    public static func frame(_ message: WireMessage) throws -> Data {
        frame(try JSONEncoder().encode(message))
    }
}
