import Foundation
import Synchronization
import Testing
import PearCore
@testable import PearInput

private func ry(_ a: Double) -> Quaternion { Quaternion(0, sin(a / 2), 0, cos(a / 2)) }
private func rx(_ a: Double) -> Quaternion { Quaternion(sin(a / 2), 0, 0, cos(a / 2)) }
private func rz(_ a: Double) -> Quaternion { Quaternion(0, 0, sin(a / 2), cos(a / 2)) }

private final class FakeClock: Sendable {
    private let value = Mutex(0.0)
    func now() -> Double { value.withLock { $0 } }
    func set(_ t: Double) { value.withLock { $0 = t } }
}

private func packet(_ id: String, kind: DeviceKind, t: Int64, seq: Int, _ q: Quaternion) -> UsisPacket {
    UsisPacket(deviceId: id, kind: kind, slot: .head, source: .sim, t: t, seq: seq, ch: UsisChannels(orientation: q))
}

@Suite struct CalibrationTests {
    @Test func rawEqualToCalibrationPoseBecomesIdentity() {
        var cal = Calibration()
        let pose = ry(0.8) * rx(0.2)
        cal.capture(deviceId: "p", kind: .phone, rawOrientation: pose)
        #expect(cal.apply(deviceId: "p", to: pose).isApproximatelyEqual(to: .identity))
    }

    @Test func worldIsTheRotationRelativeToTheCalibrationPose() {
        var cal = Calibration()
        let pose = ry(0.8) * rx(0.2)
        let delta = rz(0.3)
        cal.capture(deviceId: "p", kind: .phone, rawOrientation: pose)
        #expect(cal.apply(deviceId: "p", to: pose * delta).isApproximatelyEqual(to: delta))
    }

    @Test func yawOnlyKeepsPitchAndRemovesHeading() {
        var cal = Calibration()
        let pose = ry(.pi / 3) * rx(20 * .pi / 180)
        cal.capture(deviceId: "pods", kind: .airpods, rawOrientation: pose, mode: .yawOnly)
        let world = cal.apply(deviceId: "pods", to: pose)
        #expect(world.isApproximatelyEqual(to: rx(20 * .pi / 180), tolerance: 1e-9))
    }

    @Test func airpodsDefaultToYawOnlyAndOthersToFull() {
        #expect(CalibrationMode.default(for: .airpods) == .yawOnly)
        #expect(CalibrationMode.default(for: .phone) == .full)
        #expect(CalibrationMode.default(for: .watch) == .full)

        var cal = Calibration()
        let pose = ry(1.0) * rx(0.3)
        cal.capture(deviceId: "pods", kind: .airpods, rawOrientation: pose)
        #expect(cal.apply(deviceId: "pods", to: pose).isApproximatelyEqual(to: rx(0.3), tolerance: 1e-9))
        cal.capture(deviceId: "pods", kind: .airpods, rawOrientation: pose, mode: .full)
        #expect(cal.apply(deviceId: "pods", to: pose).isApproximatelyEqual(to: .identity))
    }

    @Test func uncalibratedDevicePassesThrough() {
        let cal = Calibration()
        let q = ry(0.4)
        #expect(cal.apply(deviceId: "never", to: q) == q)
        #expect(!cal.isCalibrated(deviceId: "never"))
    }

    @Test func resetRestoresPassThrough() {
        var cal = Calibration()
        let q = ry(0.4)
        cal.capture(deviceId: "p", kind: .phone, rawOrientation: q)
        #expect(cal.isCalibrated(deviceId: "p"))
        cal.reset(deviceId: "p")
        #expect(!cal.isCalibrated(deviceId: "p"))
        #expect(cal.apply(deviceId: "p", to: q) == q)
    }

    @Test func devicesAreCalibratedIndependently() {
        var cal = Calibration()
        cal.capture(deviceId: "a", kind: .phone, rawOrientation: ry(1.0))
        let q = ry(1.0)
        #expect(cal.apply(deviceId: "a", to: q).isApproximatelyEqual(to: .identity))
        #expect(cal.apply(deviceId: "b", to: q) == q)
    }

    // MARK: Calibration tap through the pipeline

    @Test func tapCapturesTheNewestRawOrientationAndAirPodsKeepPitch() {
        let clock = FakeClock()
        let pipeline = InputPipeline(clock: { clock.now() })
        let pose = ry(1.0) * rx(0.3)

        clock.set(0)
        pipeline.ingest(packet("pods", kind: .airpods, t: 0, seq: 0, pose))
        clock.set(100)
        pipeline.ingest(packet("pods", kind: .airpods, t: 100, seq: 1, pose))

        #expect(pipeline.calibrate(deviceId: "pods"))
        let world = pipeline.frame(at: 200).devices[0].orientation!
        #expect(world.isApproximatelyEqual(to: rx(0.3), tolerance: 1e-9))

        pipeline.resetCalibration(deviceId: "pods")
        #expect(pipeline.frame(at: 210).devices[0].orientation!.isApproximatelyEqual(to: pose, tolerance: 1e-9))
    }

    @Test func fullCalibrationOnAPhoneBecomesIdentity() {
        let clock = FakeClock()
        let pipeline = InputPipeline(clock: { clock.now() })
        let pose = ry(0.7) * rx(0.2)
        clock.set(0)
        pipeline.ingest(packet("phone", kind: .phone, t: 0, seq: 0, pose))
        #expect(pipeline.calibrate(deviceId: "phone"))
        #expect(pipeline.frame(at: 100).devices[0].orientation!.isApproximatelyEqual(to: .identity, tolerance: 1e-9))
    }

    @Test func calibratingAnUnknownDeviceFails() {
        let pipeline = InputPipeline()
        #expect(!pipeline.calibrate(deviceId: "nobody"))
    }
}
