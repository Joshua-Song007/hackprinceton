import Foundation
import Testing
import OmniCore
@testable import OmniInput

private func ry(_ angle: Double) -> Quaternion { Quaternion(0, sin(angle / 2), 0, cos(angle / 2)) }

private func makeBuffer() -> JitterBuffer {
    JitterBuffer(deviceId: "d", kind: .phone, slot: .hand)
}

private func orientation(_ q: Quaternion) -> UsisChannels { UsisChannels(orientation: q) }

@Suite struct JitterBufferTests {
    // MARK: Interpolation

    @Test func interpolatesMixedRatesAtTheRenderTime() {
        var buffer = makeBuffer()
        // 50 Hz orientation (yaw = 0.001 rad per ms) and 5 Hz heart rate
        for i in 0...30 {
            let t = Double(i) * 20
            var ch = orientation(ry(t * 0.001))
            if i % 10 == 0 { ch.heartRate = 60 + Double(i / 10) }
            buffer.push(hostTimeMs: t, arrivalMs: t, channels: ch)
        }
        let sample = buffer.sample(renderTimeMs: 330, nowMs: 380)
        #expect(sample.orientation!.isApproximatelyEqual(to: ry(0.33), tolerance: 1e-9))
        #expect(sample.heartRate == 61) // held from t = 200
        #expect(!sample.stale)
    }

    @Test func slerpsOrientationAtKnownFraction() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 100, arrivalMs: 100, channels: orientation(.identity))
        buffer.push(hostTimeMs: 120, arrivalMs: 120, channels: orientation(ry(.pi / 2)))
        let sample = buffer.sample(renderTimeMs: 110, nowMs: 130)
        #expect(sample.orientation!.isApproximatelyEqual(to: ry(.pi / 4), tolerance: 1e-9))
    }

    @Test func lerpsPositionAndAccel() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 0, arrivalMs: 0, channels: UsisChannels(position: .zero, accel: Vector3(0, 0, 0)))
        buffer.push(hostTimeMs: 100, arrivalMs: 100, channels: UsisChannels(position: Vector3(10, 0, 0), accel: Vector3(0, 4, 0)))
        let sample = buffer.sample(renderTimeMs: 25, nowMs: 125)
        #expect(abs(sample.position!.x - 2.5) < 1e-12)
        #expect(abs(sample.accel!.y - 1) < 1e-12)
    }

    @Test func lerpsPencilChannels() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 0, arrivalMs: 0,
                    channels: UsisChannels(pencil: PencilState(tip: .zero, pressure: 0, roll: 0, hover: 0.02)))
        buffer.push(hostTimeMs: 100, arrivalMs: 100,
                    channels: UsisChannels(pencil: PencilState(tip: Vector3(1, 0, 0), pressure: 1, roll: 2, hover: 0)))
        let pencil = buffer.sample(renderTimeMs: 50, nowMs: 150).pencil!
        #expect(abs(pencil.tip.x - 0.5) < 1e-12)
        #expect(abs(pencil.pressure - 0.5) < 1e-12)
        #expect(abs(pencil.roll - 1) < 1e-12)
        #expect(abs(pencil.hover - 0.01) < 1e-12)
    }

    @Test func holdsLastValueBeyondNewestSample() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 100, arrivalMs: 100, channels: orientation(.identity))
        buffer.push(hostTimeMs: 120, arrivalMs: 120, channels: orientation(ry(.pi / 2)))
        let sample = buffer.sample(renderTimeMs: 500, nowMs: 520)
        #expect(sample.orientation!.isApproximatelyEqual(to: ry(.pi / 2)))
    }

    @Test func holdsFirstValueBeforeOldestSample() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 100, arrivalMs: 100, channels: orientation(.identity))
        buffer.push(hostTimeMs: 120, arrivalMs: 120, channels: orientation(ry(.pi / 2)))
        let sample = buffer.sample(renderTimeMs: 50, nowMs: 150)
        #expect(sample.orientation!.isApproximatelyEqual(to: .identity))
    }

    @Test func channelsNeverSeenStayNil() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 0, arrivalMs: 0, channels: orientation(.identity))
        let sample = buffer.sample(renderTimeMs: 0, nowMs: 10)
        #expect(sample.position == nil && sample.accel == nil && sample.heartRate == nil && sample.pencil == nil)
    }

    @Test func insertsOutOfOrderPacketsInTimeOrder() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 200, arrivalMs: 200, channels: UsisChannels(position: Vector3(2, 0, 0)))
        buffer.push(hostTimeMs: 100, arrivalMs: 250, channels: UsisChannels(position: Vector3(1, 0, 0)))
        buffer.push(hostTimeMs: 300, arrivalMs: 300, channels: UsisChannels(position: Vector3(3, 0, 0)))
        let sample = buffer.sample(renderTimeMs: 150, nowMs: 320)
        #expect(abs(sample.position!.x - 1.5) < 1e-12)
    }

    @Test func pruningKeepsTheBracketAroundTheRenderTime() {
        var buffer = makeBuffer()
        for i in 0...30 {
            let t = Double(i) * 100
            buffer.push(hostTimeMs: t, arrivalMs: t, channels: orientation(ry(t * 0.001)))
        }
        _ = buffer.sample(renderTimeMs: 3000, nowMs: 3000)
        #expect(buffer.orientationSampleCount == 11) // 2000 … 3000
        let sample = buffer.sample(renderTimeMs: 2950, nowMs: 3000)
        #expect(sample.orientation!.isApproximatelyEqual(to: ry(2.95), tolerance: 1e-9))
    }

    // MARK: Heart rate

    @Test func firstHeartRateSampleIsNotSmoothed() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 0, arrivalMs: 0, channels: UsisChannels(heartRate: 60))
        #expect(buffer.sample(renderTimeMs: 0, nowMs: 50).heartRate == 60)
    }

    @Test func heartRateStepRisesMonotonicallyWithoutOvershoot() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 0, arrivalMs: 0, channels: UsisChannels(heartRate: 60))
        _ = buffer.sample(renderTimeMs: 0, nowMs: 50)
        buffer.push(hostTimeMs: 100, arrivalMs: 100, channels: UsisChannels(heartRate: 120))

        var previous = 60.0
        for k in 0..<25 {
            let now = 150 + 16 * Double(k)
            let hr = buffer.sample(renderTimeMs: now - 50, nowMs: now).heartRate!
            #expect(hr > previous)
            #expect(hr < 120)
            if k == 0 {
                let alpha = 1 - exp(-100.0 / 1000.0)
                #expect(abs(hr - (60 + alpha * 60)) < 1e-9)
            }
            previous = hr
        }
    }

    // MARK: Stale

    @Test func staleDeviceFreezesItsValues() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 0, arrivalMs: 0, channels: UsisChannels(orientation: ry(0.5), heartRate: 60))
        let fresh = buffer.sample(renderTimeMs: 0, nowMs: 400)
        #expect(!fresh.stale)

        let stale = buffer.sample(renderTimeMs: 550, nowMs: 600)
        #expect(stale.stale)
        #expect(stale.orientation!.isApproximatelyEqual(to: ry(0.5)))
        #expect(stale.heartRate == 60)
    }

    @Test func staleDeviceEmitsNoEventsAndRecoversOnNewPacket() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 0, arrivalMs: 0,
                    channels: UsisChannels(orientation: .identity, gesture: GestureEvent(type: .tap)))
        let stale = buffer.sample(renderTimeMs: 100, nowMs: 2000)
        #expect(stale.stale)
        #expect(stale.gestures.isEmpty)

        buffer.push(hostTimeMs: 2100, arrivalMs: 2100, channels: orientation(ry(1)))
        let recovered = buffer.sample(renderTimeMs: 2100, nowMs: 2110)
        #expect(!recovered.stale)
        #expect(recovered.orientation!.isApproximatelyEqual(to: ry(1)))
    }

    @Test func staleIsJudgedByArrivalTimeNotByConvertedTimestamp() {
        var farFuture = makeBuffer()
        farFuture.push(hostTimeMs: 1_000_000, arrivalMs: 0, channels: orientation(.identity))
        #expect(farFuture.sample(renderTimeMs: 1_000_000, nowMs: 600).stale)

        var farPast = makeBuffer()
        farPast.push(hostTimeMs: -5000, arrivalMs: 600, channels: orientation(.identity))
        #expect(!farPast.sample(renderTimeMs: 0, nowMs: 650).stale)
    }

    @Test func deviceWithNoPacketsIsStale() {
        var buffer = makeBuffer()
        #expect(buffer.sample(renderTimeMs: 0, nowMs: 0).stale)
    }

    // MARK: Events

    @Test func gestureIsDeliveredExactlyOnce() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 100, arrivalMs: 100, channels: UsisChannels(gesture: GestureEvent(type: .tap)))
        #expect(buffer.sample(renderTimeMs: 90, nowMs: 140).gestures.isEmpty)
        #expect(buffer.sample(renderTimeMs: 100, nowMs: 150).gestures == [GestureEvent(type: .tap)])
        #expect(buffer.sample(renderTimeMs: 120, nowMs: 170).gestures.isEmpty)
    }

    @Test func lateGestureIsStillDeliveredOnceOnTheNextFrame() {
        var buffer = makeBuffer()
        _ = buffer.sample(renderTimeMs: 200, nowMs: 250)
        // arrives after its own timestamp has already been rendered past
        buffer.push(hostTimeMs: 150, arrivalMs: 260, channels: UsisChannels(gesture: GestureEvent(type: .flick, dir: Vector3(1, 0, 0))))
        let next = buffer.sample(renderTimeMs: 216, nowMs: 266)
        #expect(next.gestures == [GestureEvent(type: .flick, dir: Vector3(1, 0, 0))])
        #expect(buffer.sample(renderTimeMs: 232, nowMs: 282).gestures.isEmpty)
    }

    @Test func eventsOlderThanRetentionAreDiscarded() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 0, arrivalMs: 0, channels: UsisChannels(gesture: GestureEvent(type: .tap)))
        buffer.push(hostTimeMs: 1990, arrivalMs: 1990, channels: orientation(.identity))
        #expect(buffer.sample(renderTimeMs: 2000, nowMs: 2000).gestures.isEmpty)
    }

    @Test func beganAndEndedInOneFrameBothSurvive() {
        var buffer = makeBuffer()
        buffer.push(hostTimeMs: 100, arrivalMs: 100,
                    channels: UsisChannels(touch: [TouchPoint(id: 1, x: 0.1, y: 0.2, phase: .began)]))
        buffer.push(hostTimeMs: 110, arrivalMs: 110,
                    channels: UsisChannels(touch: [TouchPoint(id: 1, x: 0.1, y: 0.2, phase: .ended)]))
        let sample = buffer.sample(renderTimeMs: 120, nowMs: 160)
        #expect(sample.touches.map(\.phase) == [.began, .ended])
        #expect(buffer.sample(renderTimeMs: 140, nowMs: 180).touches.isEmpty)
    }
}
