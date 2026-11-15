import Foundation

public enum OutputType: String, Codable, CaseIterable, Sendable {
    case haptic, audio
}

/// Game-to-device command. `intensity` is clamped to 0...1 and `durationMs` floored at 0, on init and on decode.
public struct OutputCommand: Equatable, Codable, Sendable {
    /// A deviceId or a slot name.
    public var target: String
    public var type: OutputType
    public var pattern: String
    public var intensity: Double
    public var durationMs: Int

    public init(target: String, type: OutputType, pattern: String, intensity: Double, durationMs: Int) {
        self.target = target
        self.type = type
        self.pattern = pattern
        self.intensity = min(1, max(0, intensity))
        self.durationMs = max(0, durationMs)
    }

    private enum CodingKeys: String, CodingKey {
        case target, type, pattern, intensity, durationMs
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            target: try c.decode(String.self, forKey: .target),
            type: try c.decode(OutputType.self, forKey: .type),
            pattern: try c.decode(String.self, forKey: .pattern),
            intensity: try c.decode(Double.self, forKey: .intensity),
            durationMs: try c.decode(Int.self, forKey: .durationMs)
        )
    }
}
