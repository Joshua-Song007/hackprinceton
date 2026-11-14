import Foundation
import Testing
@testable import OmniCore

@Suite struct LineFramingTests {
    @Test func splitsMultipleMessagesInOneRead() {
        var f = LineFraming()
        let lines = f.append(Data("a\nbb\nccc\n".utf8))
        #expect(lines.map { String(decoding: $0, as: UTF8.self) } == ["a", "bb", "ccc"])
        #expect(f.pendingByteCount == 0)
    }

    @Test func joinsPartialReads() {
        var f = LineFraming()
        #expect(f.append(Data("hel".utf8)).isEmpty)
        #expect(f.pendingByteCount == 3)
        let lines = f.append(Data("lo\nwor".utf8))
        #expect(lines.map { String(decoding: $0, as: UTF8.self) } == ["hello"])
        #expect(f.append(Data("ld\n".utf8)).map { String(decoding: $0, as: UTF8.self) } == ["world"])
    }

    @Test func skipsEmptyLines() {
        var f = LineFraming()
        #expect(f.append(Data("\n\nx\n\n".utf8)).count == 1)
    }

    @Test func dropsOversizedLineAcrossReadsAndRecovers() {
        var f = LineFraming(maxLineLength: 4)
        #expect(f.append(Data("abcdefgh".utf8)).isEmpty)
        #expect(f.append(Data("ij\nok\n".utf8)).map { String(decoding: $0, as: UTF8.self) } == ["ok"])
        #expect(f.oversizedCount == 1)
    }

    @Test func lineExactlyAtLimitIsKept() {
        var f = LineFraming(maxLineLength: 4)
        #expect(f.append(Data("abcd\n".utf8)).count == 1)
        #expect(f.oversizedCount == 0)
    }

    @Test func frameAppendsNewline() {
        #expect(LineFraming.frame(Data("x".utf8)) == Data("x\n".utf8))
    }

    @Test func wireMessagesRoundTripThroughFraming() throws {
        let messages: [WireMessage] = [
            .hello(deviceId: "phone-1", kind: .phone, name: "iPhone", protocolVersion: 1),
            .ping(id: 7, hostT: 1234.5),
            .pong(id: 7, deviceT: 99.25),
            .output(OutputCommand(target: "phone-1", type: .haptic, pattern: "thud", intensity: 0.8, durationMs: 120)),
        ]
        var stream = Data()
        for m in messages { stream.append(try LineFraming.frame(m)) }
        var f = LineFraming()
        var decoded: [WireMessage] = []
        // Feed one byte at a time to exercise arbitrary read boundaries.
        for byte in stream {
            for line in f.append(Data([byte])) {
                decoded.append(try JSONDecoder().decode(WireMessage.self, from: line))
            }
        }
        #expect(decoded == messages)
    }

    @Test func unknownMessageTypeFailsToDecode() {
        let json = Data(#"{"msg":"bogus"}"#.utf8)
        #expect(throws: (any Error).self) { try JSONDecoder().decode(WireMessage.self, from: json) }
    }
}
