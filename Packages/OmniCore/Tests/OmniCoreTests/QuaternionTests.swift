import Foundation
import Testing
@testable import OmniCore

private func aboutY(_ a: Double) -> Quaternion { Quaternion(0, sin(a / 2), 0, cos(a / 2)) }
private func aboutX(_ a: Double) -> Quaternion { Quaternion(sin(a / 2), 0, 0, cos(a / 2)) }
private func aboutZ(_ a: Double) -> Quaternion { Quaternion(0, 0, sin(a / 2), cos(a / 2)) }

@Suite struct QuaternionTests {
    @Test func identityIsNeutralForMultiply() {
        let q = aboutY(0.7) * aboutX(0.3)
        #expect((Quaternion.identity * q).isApproximatelyEqual(to: q))
        #expect((q * Quaternion.identity).isApproximatelyEqual(to: q))
    }

    @Test func inverseUndoesRotation() {
        let q = aboutY(0.7) * aboutX(0.3) * aboutZ(-0.4)
        #expect((q * q.inverse).isApproximatelyEqual(to: .identity))
        #expect((q.inverse * q).isApproximatelyEqual(to: .identity))
    }

    @Test func inverseIsCorrectForNonUnitInput() {
        let q = Quaternion(0, 2, 0, 2)
        #expect((q * q.inverse).isApproximatelyEqual(to: .identity))
    }

    @Test func slerpHitsEndpoints() {
        let a = aboutY(0.2)
        let b = aboutY(1.4)
        #expect(Quaternion.slerp(a, b, 0).isApproximatelyEqual(to: a))
        #expect(Quaternion.slerp(a, b, 1).isApproximatelyEqual(to: b))
    }

    @Test func slerpMidpointIsHalfwayYaw() {
        let mid = Quaternion.slerp(.identity, aboutY(.pi / 2), 0.5)
        #expect(mid.isApproximatelyEqual(to: aboutY(.pi / 4)))
    }

    @Test func slerpTakesShortestPath() {
        let b = aboutY(.pi / 2)
        let negB = Quaternion(-b.x, -b.y, -b.z, -b.w)
        let viaB = Quaternion.slerp(.identity, b, 0.5)
        let viaNegB = Quaternion.slerp(.identity, negB, 0.5)
        #expect(viaB.isApproximatelyEqual(to: viaNegB))
        #expect(viaNegB.angle(to: .identity) < .pi / 2)
    }

    @Test func slerpNearParallelStaysUnit() {
        let a = aboutY(0.5)
        let b = aboutY(0.5 + 1e-6)
        let mid = Quaternion.slerp(a, b, 0.5)
        #expect(abs(mid.norm - 1) < 1e-12)
    }

    @Test func yawOnlyLeavesPureYawUnchanged() {
        let q = aboutY(1.1)
        #expect(q.yawOnly.isApproximatelyEqual(to: q))
    }

    @Test func yawOnlyStripsPitchAndRoll() {
        let q = aboutY(1.0) * aboutX(0.4) * aboutZ(0.3)
        #expect(q.yawOnly.isApproximatelyEqual(to: aboutY(1.0), tolerance: 1e-9))
    }

    @Test func yawOnlyHandlesNegativeYaw() {
        let q = aboutY(-2.0) * aboutX(-0.3)
        #expect(q.yawOnly.isApproximatelyEqual(to: aboutY(-2.0), tolerance: 1e-9))
    }

    @Test func yawOnlyIsFiniteWhenForwardAxisIsVertical() {
        let straightUp = aboutX(.pi / 2)
        let r = straightUp.yawOnly
        #expect(r.x.isFinite && r.y.isFinite && r.z.isFinite && r.w.isFinite)
        #expect(r.isApproximatelyEqual(to: .identity))
    }

    @Test func angleBetweenOrientations() {
        #expect(abs(Quaternion.identity.angle(to: aboutY(.pi / 2)) - .pi / 2) < 1e-9)
    }

    @Test func angleTreatsNegatedQuaternionAsSameRotation() {
        let q = aboutY(0.9)
        let negQ = Quaternion(-q.x, -q.y, -q.z, -q.w)
        #expect(q.angle(to: negQ) < 1e-6)
    }

    @Test func angleNormalizesNonUnitInput() {
        let nonUnit = Quaternion(0, 2, 0, 2)
        #expect(abs(nonUnit.angle(to: .identity) - .pi / 2) < 1e-9)
    }

    @Test func codableRoundTripsAsFourNumberArray() throws {
        let q = Quaternion(0.0, 0.707, 0.0, 0.707)
        let data = try JSONEncoder().encode(q)
        #expect(String(decoding: data, as: UTF8.self).hasPrefix("["))
        #expect(try JSONDecoder().decode(Quaternion.self, from: data) == q)
    }

    @Test func decodingWrongLengthThrows() {
        let three = Data("[0,0,1]".utf8)
        let five = Data("[0,0,0,1,1]".utf8)
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(Quaternion.self, from: three) }
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(Quaternion.self, from: five) }
    }
}
