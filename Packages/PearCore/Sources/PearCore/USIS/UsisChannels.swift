import Foundation

public struct TouchPoint: Equatable, Codable, Sendable {
    public var id: Int
    public var x: Double
    public var y: Double
    public var phase: TouchPhase

    public init(id: Int, x: Double, y: Double, phase: TouchPhase) {
        self.id = id
        self.x = x
        self.y = y
        self.phase = phase
    }
}

public struct GestureEvent: Equatable, Codable, Sendable {
    public var type: GestureType
    public var dir: Vector3?

    public init(type: GestureType, dir: Vector3? = nil) {
        self.type = type
        self.dir = dir
    }
}

/// `tip` and `hover` in meters, `pressure` 0–1, `roll` in radians.
public struct PencilState: Equatable, Codable, Sendable {
    public var tip: Vector3
    public var pressure: Double
    public var roll: Double
    public var hover: Double

    public init(tip: Vector3, pressure: Double, roll: Double, hover: Double) {
        self.tip = tip
        self.pressure = pressure
        self.roll = roll
        self.hover = hover
    }
}

/// A packet carries only the channels that changed. Synthesized Codable omits nil channels on encode
/// and ignores unknown keys on decode, so newer devices don't break older apps.
public struct UsisChannels: Equatable, Codable, Sendable {
    public var orientation: Quaternion?
    public var position: Vector3?
    public var accel: Vector3?
    public var touch: [TouchPoint]?
    public var gesture: GestureEvent?
    public var heartRate: Double?
    public var pencil: PencilState?

    public init(
        orientation: Quaternion? = nil,
        position: Vector3? = nil,
        accel: Vector3? = nil,
        touch: [TouchPoint]? = nil,
        gesture: GestureEvent? = nil,
        heartRate: Double? = nil,
        pencil: PencilState? = nil
    ) {
        self.orientation = orientation
        self.position = position
        self.accel = accel
        self.touch = touch
        self.gesture = gesture
        self.heartRate = heartRate
        self.pencil = pencil
    }

    public var isEmpty: Bool {
        orientation == nil && position == nil && accel == nil && touch == nil
            && gesture == nil && heartRate == nil && pencil == nil
    }
}
