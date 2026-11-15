import Foundation

/// Right-handed, +Y up. Stored and serialized as `[x, y, z, w]`.
public struct Quaternion: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var z: Double
    public var w: Double

    public static let identity = Quaternion(0, 0, 0, 1)

    public init(_ x: Double, _ y: Double, _ z: Double, _ w: Double) {
        self.x = x
        self.y = y
        self.z = z
        self.w = w
    }

    public var norm: Double {
        (x * x + y * y + z * z + w * w).squareRoot()
    }

    /// Zero-norm input returns `.identity`.
    public var normalized: Quaternion {
        let n = norm
        guard n > 0 else { return .identity }
        return Quaternion(x / n, y / n, z / n, w / n)
    }

    /// Hamilton product `self * other`: applies `other` first, then `self`.
    public func multiply(_ o: Quaternion) -> Quaternion {
        Quaternion(
            w * o.x + x * o.w + y * o.z - z * o.y,
            w * o.y - x * o.z + y * o.w + z * o.x,
            w * o.z + x * o.y - y * o.x + z * o.w,
            w * o.w - x * o.x - y * o.y - z * o.z
        )
    }

    public static func * (a: Quaternion, b: Quaternion) -> Quaternion {
        a.multiply(b)
    }

    /// Conjugate over norm squared, so it is also correct for non-unit input.
    public var inverse: Quaternion {
        let n2 = x * x + y * y + z * z + w * w
        guard n2 > 0 else { return .identity }
        return Quaternion(-x / n2, -y / n2, -z / n2, w / n2)
    }

    public func dot(_ o: Quaternion) -> Double {
        x * o.x + y * o.y + z * o.z + w * o.w
    }

    /// Shortest-path spherical interpolation; falls back to normalized lerp when nearly parallel.
    public static func slerp(_ a: Quaternion, _ b: Quaternion, _ u: Double) -> Quaternion {
        var cosTheta = a.dot(b)
        var end = b
        if cosTheta < 0 {
            end = Quaternion(-b.x, -b.y, -b.z, -b.w)
            cosTheta = -cosTheta
        }
        if cosTheta > 0.9995 {
            return Quaternion(
                a.x + (end.x - a.x) * u,
                a.y + (end.y - a.y) * u,
                a.z + (end.z - a.z) * u,
                a.w + (end.w - a.w) * u
            ).normalized
        }
        let theta = acos(cosTheta)
        let sinTheta = sin(theta)
        let wa = sin((1 - u) * theta) / sinTheta
        let wb = sin(u * theta) / sinTheta
        return Quaternion(
            a.x * wa + end.x * wb,
            a.y * wa + end.y * wb,
            a.z * wa + end.z * wb,
            a.w * wa + end.w * wb
        )
    }

    /// Keeps only the rotation about +Y. Yaw is read from where the +Z axis points in the XZ plane,
    /// so it is exact for q = Ry(yaw) * Rx(pitch) * Rz(roll) with |pitch| < 90°.
    /// When +Z is vertical the heading is undefined and yaw is taken as 0.
    public var yawOnly: Quaternion {
        let q = normalized
        let sx = 2 * (q.x * q.z + q.w * q.y)
        let sz = 1 - 2 * (q.x * q.x + q.y * q.y)
        guard abs(sx) > 1e-12 || abs(sz) > 1e-12 else { return .identity }
        let yaw = atan2(sx, sz)
        return Quaternion(0, sin(yaw / 2), 0, cos(yaw / 2))
    }

    /// Rotation angle between two orientations, radians in [0, π]. Inputs are normalized first.
    public func angle(to other: Quaternion) -> Double {
        let d = abs(normalized.dot(other.normalized))
        return 2 * acos(min(1, max(-1, d)))
    }

    /// Equality treating q and -q as the same rotation.
    public func isApproximatelyEqual(to other: Quaternion, tolerance: Double = 1e-9) -> Bool {
        let sign: Double = dot(other) < 0 ? -1 : 1
        return abs(x - sign * other.x) <= tolerance
            && abs(y - sign * other.y) <= tolerance
            && abs(z - sign * other.z) <= tolerance
            && abs(w - sign * other.w) <= tolerance
    }
}

extension Quaternion: Codable {
    public init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        guard container.count == 4 else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath,
                      debugDescription: "Quaternion expects exactly 4 numbers, got \(container.count ?? -1)")
            )
        }
        self.init(try container.decode(Double.self),
                  try container.decode(Double.self),
                  try container.decode(Double.self),
                  try container.decode(Double.self))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.unkeyedContainer()
        try container.encode(x)
        try container.encode(y)
        try container.encode(z)
        try container.encode(w)
    }
}
