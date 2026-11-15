import Foundation

public struct Pose: Equatable, Codable, Sendable {
    public var position: Vector3
    public var orientation: Quaternion

    public static let identity = Pose(position: .zero, orientation: .identity)

    public init(position: Vector3, orientation: Quaternion) {
        self.position = position
        self.orientation = orientation
    }
}
