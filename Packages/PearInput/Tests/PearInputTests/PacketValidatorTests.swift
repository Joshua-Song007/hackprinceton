import Foundation
import Synchronization
import Testing
import PearCore
@testable import PearInput

private final class FakeClock: Sendable {
    private let value = Mutex(0.0)
    func now() -> Double { value.withLock { $0 } }
    func set(_ t: Double) { value.withLock { $0 = t } }
}

private func packet(
    _ id: String = "p-1",
    v: Int = 1,
    t: Int64 = 0,
    seq: Int = 0,
    ch: UsisChannels = UsisChannels()
) -> UsisPacket {
    UsisPacket(v: v, deviceId: id, kind: .phone, slot: .hand, source: .sim, t: t, seq: seq, ch: ch)
}

private let overviewJSON = """
{"v":1,"deviceId":"watch-1","kind":"watch","slot":"leftWrist","source":"live","t":1731550000123,"seq":4182,
 "ch":{"orientation":[0.0,0.707,0.0,0.707],"accel":[0.02,-9.79,0.11],"heartRate":128,
       "gesture":{"type":"flick","dir":[1,0,0]}}}
"""

private func jsonPacket(id: String, v: Int = 1) -> Data {
    Data("""
    {"v":\(v),"deviceId":"\(id)","kind":"phone","slot":"hand","source":"sim","t":1,"seq":1,"ch":{}}
    """.utf8)
}

@Suite struct PacketValidatorTests {
    let validator = PacketValidator()

    // MARK: Valid packets

    @Test func overviewExamplePacketIsValid() throws {
        let packet = try validator.decode(Data(overviewJSON.utf8)).get()
        #expect(packet.deviceId == "watch-1")
        #expect(packet.ch.heartRate == 128)
    }

    @Test func emptyChannelsAreValidKeepAlive() {
        #expect(validator.validate(packet()) == nil)
    }

    @Test func unknownChannelsAreAccepted() throws {
        let json = #"{"v":1,"deviceId":"p","kind":"phone","slot":"hand","source":"sim","t":1,"seq":1,"ch":{"barometer":{"hpa":1013}}}"#
        #expect(try validator.decode(Data(json.utf8)).get().ch.isEmpty)
    }

    @Test func deviceIdOfExactlyMaxLengthIsValid() {
        #expect(validator.validate(packet(String(repeating: "a", count: 128))) == nil)
    }

    // MARK: Invalid packets

    @Test func rejectsOtherVersions() {
        #expect(validator.validate(packet(v: 2)) == .unsupportedVersion(2))
    }

    @Test func rejectsEmptyAndOverlongDeviceId() {
        #expect(validator.validate(packet("")) == .emptyDeviceId)
        #expect(validator.validate(packet(String(repeating: "a", count: 129))) == .deviceIdTooLong)
    }

    @Test func rejectsNegativeTimestampAndSequence() {
        #expect(validator.validate(packet(t: -1)) == .negativeTimestamp)
        #expect(validator.validate(packet(seq: -1)) == .negativeSequence)
    }

    @Test func rejectsNonUnitQuaternion() {
        let ch = UsisChannels(orientation: Quaternion(0, 1.5, 0, 0))
        #expect(validator.validate(packet(ch: ch)) == .nonUnitQuaternion)
        let zero = UsisChannels(orientation: Quaternion(0, 0, 0, 0))
        #expect(validator.validate(packet(ch: zero)) == .nonUnitQuaternion)
    }

    @Test func acceptsQuaternionWithinTolerance() {
        let ch = UsisChannels(orientation: Quaternion(0, 0.707, 0, 0.707))
        #expect(validator.validate(packet(ch: ch)) == nil)
    }

    @Test func rejectsNonFiniteNumbers() {
        let nanAccel = UsisChannels(accel: Vector3(.nan, 0, 0))
        #expect(validator.validate(packet(ch: nanAccel)) == .nonFiniteValue(.accel))
        let infOrientation = UsisChannels(orientation: Quaternion(0, 0, 0, .infinity))
        #expect(validator.validate(packet(ch: infOrientation)) == .nonFiniteValue(.orientation))
    }

    @Test func rejectsOutOfRangeTouchPressureAndHeartRate() {
        let touch = UsisChannels(touch: [TouchPoint(id: 1, x: 1.2, y: 0.5, phase: .began)])
        #expect(validator.validate(packet(ch: touch)) == .touchOutOfRange)

        let pencil = UsisChannels(pencil: PencilState(tip: .zero, pressure: -0.1, roll: 0, hover: 0))
        #expect(validator.validate(packet(ch: pencil)) == .pressureOutOfRange)

        let hr = UsisChannels(heartRate: -5)
        #expect(validator.validate(packet(ch: hr)) == .negativeHeartRate)
    }

    // MARK: Raw JSON

    @Test func malformedJSONIsReported() {
        #expect(validator.decode(Data("{not json".utf8)) == .failure(.malformedJSON))
    }

    @Test func missingEnvelopeFieldIsMalformed() {
        let json = #"{"v":1,"kind":"phone","slot":"hand","source":"sim","t":1,"seq":1,"ch":{}}"#
        #expect(validator.decode(Data(json.utf8)) == .failure(.malformedJSON))
    }

    @Test func wellFormedButInvalidJSONReportsTheRule() {
        #expect(validator.decode(jsonPacket(id: "p", v: 2)) == .failure(.unsupportedVersion(2)))
    }

    // MARK: Drop counting through the pipeline

    @Test func invalidPacketOnTrackedDeviceCountsAgainstThatDevice() {
        let clock = FakeClock()
        let pipeline = InputPipeline(clock: { clock.now() })
        pipeline.ingest(packet("p-1"))
        pipeline.ingest(json: jsonPacket(id: "p-1", v: 2))
        pipeline.ingest(packet("p-1", seq: -1))

        let stats = pipeline.statsSnapshot()
        #expect(stats.count == 1)
        #expect(stats[0].schemaErrors == 2)
        #expect(pipeline.unattributedErrorCount == 0)
    }

    @Test func garbageAndUnknownDevicesAreUnattributedAndCreateNothing() {
        let clock = FakeClock()
        let pipeline = InputPipeline(clock: { clock.now() })
        pipeline.ingest(packet("p-1"))
        pipeline.ingest(json: jsonPacket(id: "ghost", v: 2))
        pipeline.ingest(json: Data("not json".utf8))

        #expect(pipeline.unattributedErrorCount == 2)
        #expect(pipeline.statsSnapshot().map(\.deviceId) == ["p-1"])
    }

    @Test func droppedPacketNeverReachesAFrame() {
        let clock = FakeClock()
        let pipeline = InputPipeline(clock: { clock.now() })
        pipeline.ingest(packet("bad", v: 2))
        #expect(pipeline.frame(at: 100).devices.isEmpty)
        #expect(pipeline.unattributedErrorCount == 1)
    }

    @Test func deviceBeyondTheCapIsRejectedAndCounted() {
        let clock = FakeClock()
        let pipeline = InputPipeline(clock: { clock.now() })
        for i in 0..<17 {
            pipeline.ingest(packet("d-\(i)"))
        }
        #expect(pipeline.statsSnapshot().count == 16)
        #expect(pipeline.rejectedDeviceCount == 1)
        #expect(pipeline.frame(at: 100).devices.count == 16)
    }
}
