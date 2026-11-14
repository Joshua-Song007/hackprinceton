import Foundation
import OmniCore
import RealityKit
import simd

/// Moves the audio listener with the head pose from the `InputFrame`. An ECS-style system called by the host each
/// frame (like `TriggerSystem`), not a registered `RealityKit.System`, so it runs headless. Head position is the head
/// sample's `position` when present, else `playerOrigin`. A missing, orientation-less or stale head leaves the
/// listener where it was.
@MainActor
public enum AudioListenerSystem {
    /// A new listener entity; add it to the scene and pass it to `apply`. Host views that need an explicit audio
    /// listener component (macOS 26+ `AudioListenerComponent`) set it themselves; the package targets macOS 15.
    public static func makeListener() -> Entity {
        let listener = Entity()
        listener.name = "AudioListener"
        return listener
    }

    /// Sets `listener`'s world transform. Returns `true` if the pose was updated.
    @discardableResult
    public static func apply(frame: InputFrame, listener: Entity, playerOrigin: Vector3) -> Bool {
        guard let head = frame.device(slot: .head), !head.stale, let q = head.orientation else { return false }
        let p = head.position ?? playerOrigin
        let n = q.normalized
        listener.setPosition(SIMD3(Float(p.x), Float(p.y), Float(p.z)), relativeTo: nil)
        listener.setOrientation(simd_quatf(ix: Float(n.x), iy: Float(n.y), iz: Float(n.z), r: Float(n.w)), relativeTo: nil)
        return true
    }
}
