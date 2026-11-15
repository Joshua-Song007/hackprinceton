import Foundation
import PearCore

/// A world-space ray from the head.
public struct GazeRay: Equatable, Sendable {
    public var origin: Vector3
    public var direction: Vector3
}

/// Mouse-driven gaze ray from the head; a click becomes a pinch.
public final class GazeRaycaster {
    /// Vertical field of view of the viewport camera, radians.
    public let verticalFov: Double
    /// Where pinches go: any watch (the only simulated device with a gesture channel). Nil drops the click.
    public var pinchTarget: VirtualWatch?

    public init(verticalFov: Double = .pi / 3, pinchTarget: VirtualWatch? = nil) {
        self.verticalFov = verticalFov.isFinite && verticalFov > 0 && verticalFov < .pi ? verticalFov : .pi / 3
        self.pinchTarget = pinchTarget
    }

    /// Rotates `v` by the unit quaternion `q`.
    static func rotate(_ v: Vector3, by q: Quaternion) -> Vector3 {
        let r = q * Quaternion(v.x, v.y, v.z, 0) * q.inverse
        return Vector3(r.x, r.y, r.z)
    }

    /// Ray for a mouse position. `mouseX` / `mouseY` are normalized 0–1 over the viewport (origin top-left, y down);
    /// out-of-range values are clamped. With the mouse at the centre the ray is the head's forward (−Z) vector.
    public func ray(
        headPosition: Vector3, headOrientation: Quaternion, mouseX: Double, mouseY: Double, aspect: Double
    ) -> GazeRay {
        let clamp: (Double) -> Double = { $0.isFinite ? min(1, max(0, $0)) : 0.5 }
        let a = aspect.isFinite && aspect > 0 ? aspect : 1
        let ndcX = clamp(mouseX) * 2 - 1
        let ndcY = 1 - clamp(mouseY) * 2
        let t = tan(verticalFov / 2)
        let local = Vector3(ndcX * t * a, ndcY * t, -1).normalized
        return GazeRay(
            origin: headPosition, direction: Self.rotate(local, by: headOrientation.normalized).normalized
        )
    }

    /// A click pinches along `ray`: returns the gesture and queues it on `pinchTarget` when one is set.
    @discardableResult
    public func click(along ray: GazeRay) -> GestureEvent {
        let event = GestureEvent(type: .pinch, dir: ray.direction)
        pinchTarget?.queueGesture(.pinch, dir: ray.direction)
        return event
    }
}
