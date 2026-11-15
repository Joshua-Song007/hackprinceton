import Foundation

public enum DeviceKind: String, Codable, CaseIterable, Sendable {
    case phone, tablet, airpods, watch, pencil, headset, custom
}

public enum Slot: String, Codable, CaseIterable, Sendable {
    case head, leftWrist, rightWrist, hand, pocket, stylus
}

public enum PacketSource: String, Codable, CaseIterable, Sendable {
    case live, sim
}

public enum GestureType: String, Codable, CaseIterable, Sendable {
    case tap, doubleTap, flick, squeeze, pinch
}

public enum TouchPhase: String, Codable, CaseIterable, Sendable {
    case began, moved, ended
}
