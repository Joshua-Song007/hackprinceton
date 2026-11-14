import Foundation
import Testing
@testable import OmniCore

private let overviewPacketJSON = """
{
  "v": 1,
  "deviceId": "watch-1",
  "kind": "watch",
  "slot": "leftWrist",
  "source": "live",
  "t": 1731550000123,
  "seq": 4182,
  "ch": {
    "orientation": [0.0, 0.707, 0.0, 0.707],
    "accel": [0.02, -9.79, 0.11],
    "heartRate": 128,
    "gesture": { "type": "flick", "dir": [1, 0, 0] }
  }
}
"""

private func decodePacket(_ json: String) throws -> UsisPacket {
    try JSONDecoder().decode(UsisPacket.self, from: Data(json.utf8))
}

@Suite struct UsisPacketTests {
    @Test func decodesOverviewExamplePacket() throws {
        let p = try decodePacket(overviewPacketJSON)
        #expect(p.v == 1)
        #expect(p.deviceId == "watch-1")
        #expect(p.kind == .watch)
        #expect(p.slot == .leftWrist)
        #expect(p.source == .live)
        #expect(p.t == 1_731_550_000_123)
        #expect(p.seq == 4182)
        #expect(p.ch.orientation == Quaternion(0.0, 0.707, 0.0, 0.707))
        #expect(p.ch.accel == Vector3(0.02, -9.79, 0.11))
        #expect(p.ch.heartRate == 128)
        #expect(p.ch.gesture == GestureEvent(type: .flick, dir: Vector3(1, 0, 0)))
        #expect(p.ch.position == nil)
        #expect(p.ch.touch == nil)
        #expect(p.ch.pencil == nil)
    }

    @Test func encodeDecodeRoundTripIsLossless() throws {
        let original = try decodePacket(overviewPacketJSON)
        let data = try JSONEncoder().encode(original)
        let again = try JSONDecoder().decode(UsisPacket.self, from: data)
        #expect(again == original)
    }

    @Test func unknownChannelsAreIgnored() throws {
        let json = """
        {"v":1,"deviceId":"p-1","kind":"phone","slot":"hand","source":"sim","t":10,"seq":1,
         "ch":{"heartRate":70,"barometer":{"hpa":1013.2},"futureThing":[1,2,3]}}
        """
        let p = try decodePacket(json)
        #expect(p.ch.heartRate == 70)
        #expect(p.ch.orientation == nil)
    }

    @Test func partialChannelsLeaveOthersNil() throws {
        let json = """
        {"v":1,"deviceId":"w-1","kind":"watch","slot":"rightWrist","source":"sim","t":5,"seq":2,
         "ch":{"heartRate":96}}
        """
        let p = try decodePacket(json)
        #expect(p.ch.heartRate == 96)
        #expect(p.ch.orientation == nil && p.ch.position == nil && p.ch.accel == nil)
        #expect(p.ch.touch == nil && p.ch.gesture == nil && p.ch.pencil == nil)
    }

    @Test func encodingOmitsAbsentChannelsInsteadOfWritingNull() throws {
        let p = UsisPacket(deviceId: "w-1", kind: .watch, slot: .leftWrist, source: .sim, t: 1, seq: 1,
                           ch: UsisChannels(heartRate: 80))
        let text = String(decoding: try JSONEncoder().encode(p), as: UTF8.self)
        #expect(!text.contains("null"))
        #expect(!text.contains("orientation"))
        #expect(text.contains("heartRate"))
    }

    @Test func emptyChannelsReportEmpty() {
        #expect(UsisChannels().isEmpty)
        #expect(!UsisChannels(heartRate: 60).isEmpty)
    }

    @Test func touchAndPencilChannelsRoundTrip() throws {
        let ch = UsisChannels(
            touch: [TouchPoint(id: 1, x: 0.25, y: 0.75, phase: .began)],
            pencil: PencilState(tip: Vector3(0.1, 0.2, 0.3), pressure: 0.5, roll: 1.2, hover: 0.01)
        )
        let p = UsisPacket(deviceId: "pen-1", kind: .pencil, slot: .stylus, source: .live, t: 99, seq: 7, ch: ch)
        let again = try JSONDecoder().decode(UsisPacket.self, from: try JSONEncoder().encode(p))
        #expect(again == p)
    }

    @Test func decodeDoesNotRejectOtherVersions() throws {
        let json = """
        {"v":2,"deviceId":"x","kind":"custom","slot":"hand","source":"live","t":1,"seq":1,"ch":{}}
        """
        #expect(try decodePacket(json).v == 2)
    }

    @Test func unknownKindThrows() {
        let json = """
        {"v":1,"deviceId":"x","kind":"toaster","slot":"hand","source":"live","t":1,"seq":1,"ch":{}}
        """
        #expect(throws: DecodingError.self) { try decodePacket(json) }
    }

    @Test func wrongLengthOrientationThrows() {
        let json = """
        {"v":1,"deviceId":"x","kind":"phone","slot":"hand","source":"live","t":1,"seq":1,
         "ch":{"orientation":[0,0,1]}}
        """
        #expect(throws: DecodingError.self) { try decodePacket(json) }
    }

    @Test func missingEnvelopeFieldThrows() {
        let json = """
        {"v":1,"kind":"phone","slot":"hand","source":"live","t":1,"seq":1,"ch":{}}
        """
        #expect(throws: DecodingError.self) { try decodePacket(json) }
    }

    @Test func outputCommandRoundTrips() throws {
        let cmd = OutputCommand(target: "leftWrist", type: .haptic, pattern: "pulse", intensity: 0.5, durationMs: 120)
        let again = try JSONDecoder().decode(OutputCommand.self, from: try JSONEncoder().encode(cmd))
        #expect(again == cmd)
    }

    @Test func outputCommandClampsOnDecode() throws {
        let json = """
        {"target":"head","type":"audio","pattern":"ping","intensity":1.7,"durationMs":-5}
        """
        let cmd = try JSONDecoder().decode(OutputCommand.self, from: Data(json.utf8))
        #expect(cmd.intensity == 1)
        #expect(cmd.durationMs == 0)
    }

    @Test func outputCommandClampsOnInit() {
        let cmd = OutputCommand(target: "head", type: .audio, pattern: "ping", intensity: -0.3, durationMs: 50)
        #expect(cmd.intensity == 0)
    }
}
