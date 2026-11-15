import Foundation
import PearCore

public struct DeviceDescriptor: Equatable, Sendable {
    public var deviceId: String
    public var kind: DeviceKind
    public var slot: Slot
    public var sampleRateHz: Double
    public var channels: Set<ChannelKind>

    public init(deviceId: String, kind: DeviceKind, slot: Slot, sampleRateHz: Double, channels: Set<ChannelKind>) {
        self.deviceId = deviceId
        self.kind = kind
        self.slot = slot
        self.sampleRateHz = sampleRateHz
        self.channels = channels
    }
}

/// Anything that produces USIS packets: live bridge, AirPods, the simulator, a recording player.
/// A source pushes into the bus it is started with, so it can also report clock-sync pings.
public protocol InputSource: AnyObject, Sendable {
    var descriptors: [DeviceDescriptor] { get }
    func start(bus: InputBus)
    func stop()
}
