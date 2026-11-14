import Foundation
import Testing
import OmniCore
@testable import OmniBridge

private func axisAngle(_ x: Double, _ y: Double, _ z: Double, _ angle: Double) -> Quaternion {
    let s = sin(angle / 2)
    return Quaternion(x * s, y * s, z * s, cos(angle / 2))
}

@Suite struct AirPodsMotionSourceTests {
    typealias S = AirPodsMotionSource
    let angle = 0.6

    // MARK: omniQuaternion

    @Test func nodAboutAppleXStaysAboutOmniX() {
        let q = S.omniQuaternion(x: sin(angle / 2), y: 0, z: 0, w: cos(angle / 2))
        #expect(q.isApproximatelyEqual(to: axisAngle(1, 0, 0, angle)))
    }

    @Test func turnLeftAboutAppleZBecomesRotationAboutOmniY() {
        let q = S.omniQuaternion(x: 0, y: 0, z: sin(angle / 2), w: cos(angle / 2))
        #expect(q.isApproximatelyEqual(to: axisAngle(0, 1, 0, angle)))
    }

    @Test func rotationAboutAppleYBecomesOmniMinusZ() {
        let q = S.omniQuaternion(x: 0, y: sin(angle / 2), z: 0, w: cos(angle / 2))
        #expect(q.isApproximatelyEqual(to: axisAngle(0, 0, -1, angle)))
    }

    @Test func omniQuaternionIsUnitLengthAndNormalizesInput() {
        let q = S.omniQuaternion(x: 0.2, y: 0.4, z: 0.1, w: 0.9)
        #expect(abs(q.norm - 1) < 1e-12)
        let identity = S.omniQuaternion(x: 0, y: 0, z: 0, w: 1)
        #expect(identity.isApproximatelyEqual(to: .identity))
    }

    // MARK: omniVector / omniAccel

    @Test func vectorAxisMap() {
        #expect(S.omniVector(x: 1, y: 2, z: 3) == Vector3(1, 3, -2))
    }

    @Test func accelScalesGToMetersPerSecondSquaredAndMapsAxes() {
        let a = S.omniAccel(x: 1, y: 2, z: 3)
        #expect(abs(a.x - 9.81) < 1e-12)
        #expect(abs(a.y - 3 * 9.81) < 1e-12)
        #expect(abs(a.z - -2 * 9.81) < 1e-12)
        // Forward (Apple +Y) maps to Omni -Z.
        #expect(S.omniAccel(x: 0, y: 1, z: 0).z < 0)
    }

    // MARK: reanchored

    @Test func noBudChangeKeepsIdentityAnchorAndPassesThrough() {
        var anchor = Quaternion.identity
        let c = axisAngle(0, 1, 0, 0.4)
        let out = S.reanchored(c, budChanged: false, lastOut: axisAngle(1, 0, 0, 1), anchor: &anchor)
        #expect(anchor == .identity)
        #expect(out.isApproximatelyEqual(to: c))
    }

    @Test func budChangeLandsOnLastOut() {
        var anchor = Quaternion.identity
        let lastOut = axisAngle(0, 1, 0, 0.3)
        let jumped = axisAngle(0, 1, 0, 0.3 + 1.3)
        let out = S.reanchored(jumped, budChanged: true, lastOut: lastOut, anchor: &anchor)
        #expect(out.isApproximatelyEqual(to: lastOut, tolerance: 1e-9))
        #expect(abs(out.norm - 1) < 1e-12)
    }

    @Test func motionAfterBudChangeIsRelativeToNewBudFirstSample() {
        var anchor = Quaternion.identity
        let lastOut = axisAngle(0, 1, 0, 0.3)
        let first = axisAngle(1, 0, 0, 1.2)
        let out1 = S.reanchored(first, budChanged: true, lastOut: lastOut, anchor: &anchor)
        let next = (first * axisAngle(0, 1, 0, 0.25)).normalized
        let out2 = S.reanchored(next, budChanged: false, lastOut: out1, anchor: &anchor)
        let expected = (lastOut * axisAngle(0, 1, 0, 0.25)).normalized
        #expect(out2.isApproximatelyEqual(to: expected, tolerance: 1e-9))
        #expect(abs(out1.inverse.multiply(out2).angle(to: .identity) - 0.25) < 1e-9)
    }

    @Test func budChangeWithoutLastOutKeepsAnchor() {
        var anchor = Quaternion.identity
        let c = axisAngle(0, 0, 1, 0.5)
        let out = S.reanchored(c, budChanged: true, lastOut: nil, anchor: &anchor)
        #expect(anchor == .identity)
        #expect(out.isApproximatelyEqual(to: c))
    }
}
