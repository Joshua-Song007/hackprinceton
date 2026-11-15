import Foundation

/// One device's world-space state for a frame. Deliberately has no `source`: games cannot tell sim from live.
public struct DeviceSample: Equatable, Sendable {
    public var deviceId: String
    public var kind: DeviceKind
    public var slot: Slot
    public var stale: Bool
    public var orientation: Quaternion?
    public var position: Vector3?
    public var accel: Vector3?
    public var touches: [TouchPoint]
    public var gestures: [GestureEvent]
    public var heartRate: Double?
    public var pencil: PencilState?

    public init(
        deviceId: String,
        kind: DeviceKind,
        slot: Slot,
        stale: Bool = false,
        orientation: Quaternion? = nil,
        position: Vector3? = nil,
        accel: Vector3? = nil,
        touches: [TouchPoint] = [],
        gestures: [GestureEvent] = [],
        heartRate: Double? = nil,
        pencil: PencilState? = nil
    ) {
        self.deviceId = deviceId
        self.kind = kind
        self.slot = slot
        self.stale = stale
        self.orientation = orientation
        self.position = position
        self.accel = accel
        self.touches = touches
        self.gestures = gestures
        self.heartRate = heartRate
        self.pencil = pencil
    }
}

/// World-space per-frame snapshot handed to the runtime. `timestamp` is host time in milliseconds.
public struct InputFrame: Equatable, Sendable {
    public var timestamp: Double
    public var devices: [DeviceSample]

    public static let empty = InputFrame(timestamp: 0, devices: [])

    public init(timestamp: Double, devices: [DeviceSample]) {
        self.timestamp = timestamp
        self.devices = devices
    }

    public func device(slot: Slot) -> DeviceSample? {
        devices.first { $0.slot == slot }
    }
}
