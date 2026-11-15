import Foundation

public struct Vector3: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var z: Double

    public static let zero = Vector3(0, 0, 0)

    public init(_ x: Double, _ y: Double, _ z: Double) {
        self.x = x
        self.y = y
        self.z = z
    }

    public static func + (a: Vector3, b: Vector3) -> Vector3 {
        Vector3(a.x + b.x, a.y + b.y, a.z + b.z)
    }

    public static func - (a: Vector3, b: Vector3) -> Vector3 {
        Vector3(a.x - b.x, a.y - b.y, a.z - b.z)
    }

    public static func * (a: Vector3, s: Double) -> Vector3 {
        Vector3(a.x * s, a.y * s, a.z * s)
    }

    public func dot(_ other: Vector3) -> Double {
        x * other.x + y * other.y + z * other.z
    }

    public var length: Double {
        dot(self).squareRoot()
    }

    /// Zero-length input returns `.zero` rather than NaN.
    public var normalized: Vector3 {
        let len = length
        guard len > 0 else { return .zero }
        return self * (1 / len)
    }

    public static func lerp(_ a: Vector3, _ b: Vector3, _ u: Double) -> Vector3 {
        a + (b - a) * u
    }
}

extension Vector3: Codable {
    public init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        guard container.count == 3 else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath,
                      debugDescription: "Vector3 expects exactly 3 numbers, got \(container.count ?? -1)")
            )
        }
        self.init(try container.decode(Double.self),
                  try container.decode(Double.self),
                  try container.decode(Double.self))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.unkeyedContainer()
        try container.encode(x)
        try container.encode(y)
        try container.encode(z)
    }
}
