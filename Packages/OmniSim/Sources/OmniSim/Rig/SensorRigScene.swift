import Foundation
import RealityKit
import OmniCore

/// Pure slot -> device mapping for the sensor rig: which virtual device a slot spawns and where the slot sits on the avatar.
/// Kept free of RealityKit so it is testable without a scene.
public enum RigSlotMap {
    /// Device kind each slot spawns when clicked.
    public static func kind(for slot: Slot) -> DeviceKind {
        switch slot {
        case .head: return .airpods
        case .leftWrist, .rightWrist: return .watch
        case .hand, .pocket: return .phone
        case .stylus: return .pencil
        }
    }

    /// Slot position in avatar-local meters (+X right, +Y up, −Z forward; the avatar faces −Z).
    public static func localPosition(of slot: Slot) -> Vector3 {
        switch slot {
        case .head: return Vector3(0, 1.7, 0)
        case .leftWrist: return Vector3(-0.35, 1.0, -0.1)
        case .rightWrist: return Vector3(0.35, 1.0, -0.1)
        case .hand: return Vector3(0.4, 1.2, -0.3)
        case .pocket: return Vector3(0.2, 0.9, 0)
        case .stylus: return Vector3(-0.4, 1.2, -0.3)
        }
    }

    /// Entity name used for the clickable marker of a slot.
    public static func entityName(for slot: Slot) -> String { "slot-\(slot.rawValue)" }

    /// Reverse of `entityName(for:)`; nil for any other name.
    public static func slot(forEntityName name: String) -> Slot? {
        guard name.hasPrefix("slot-") else { return nil }
        return Slot(rawValue: String(name.dropFirst("slot-".count)))
    }

    /// Builds the virtual device for a slot. The id is `sim-<slot>` so two wrists never share an id.
    public static func makeDevice(for slot: Slot, seed: UInt64 = 1) -> VirtualDevice {
        let id = "sim-\(slot.rawValue)"
        switch kind(for: slot) {
        case .airpods: return VirtualAirPods(deviceId: id, seed: seed)
        case .watch: return VirtualWatch(deviceId: id, slot: slot, seed: seed)
        case .phone: return VirtualPhone(deviceId: id, slot: slot, seed: seed)
        default: return VirtualPencil(deviceId: id, seed: seed)
        }
    }
}

/// RealityKit avatar with one clickable marker per device slot. Clicking a marker (`toggle(slot:)`) spawns the slot's
/// virtual device; the caller starts it on the `InputBus`. Main-actor because it owns RealityKit entities.
@MainActor
public final class SensorRigScene {
    public let root = Entity()
    public private(set) var devices: [Slot: VirtualDevice] = [:]
    private var markers: [Slot: ModelEntity] = [:]

    public init() {
        root.name = "sensor-rig"
        let body = ModelEntity(mesh: .generateBox(size: [0.4, 0.9, 0.2]))
        body.name = "avatar-body"
        body.position = [0, 1.15, 0]
        root.addChild(body)
        for slot in Slot.allCases {
            let marker = ModelEntity(mesh: .generateSphere(radius: 0.06))
            marker.name = RigSlotMap.entityName(for: slot)
            let p = RigSlotMap.localPosition(of: slot)
            marker.position = SIMD3<Float>(Float(p.x), Float(p.y), Float(p.z))
            marker.components.set(CollisionComponent(shapes: [.generateSphere(radius: 0.06)]))
            root.addChild(marker)
            markers[slot] = marker
        }
    }

    /// Spawns the slot's device if empty, otherwise removes it (stopping it). Returns the device now in the slot.
    @discardableResult
    public func toggle(slot: Slot, seed: UInt64 = 1) -> VirtualDevice? {
        if let existing = devices.removeValue(forKey: slot) {
            existing.stop()
            return nil
        }
        let device = RigSlotMap.makeDevice(for: slot, seed: seed)
        devices[slot] = device
        return device
    }

    /// The slot whose marker is `entity`, for hit-testing a click.
    public func slot(for entity: Entity) -> Slot? { RigSlotMap.slot(forEntityName: entity.name) }

    /// Rotates a slot's marker to show the device's current orientation.
    public func syncVisuals() {
        for (slot, device) in devices {
            let q = device.targetOrientation
            markers[slot]?.orientation = simd_quatf(
                ix: Float(q.x), iy: Float(q.y), iz: Float(q.z), r: Float(q.w)
            )
        }
    }
}
