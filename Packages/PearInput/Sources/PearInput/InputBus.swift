import Foundation
import PearCore

public protocol InputBus: AnyObject, Sendable {
    func ingest(_ packet: UsisPacket)
    func ingest(json: Data)

    /// One ping exchange: `tSendDevice` and `tRecvDevice` are on the device clock, `tHostReceived` on the host clock.
    func recordClockSample(deviceId: String, tSendDevice: Double, tHostReceived: Double, tRecvDevice: Double)

    func frame(at hostNowMs: Double) -> InputFrame
}

extension InputBus {
    public func frame() -> InputFrame {
        frame(at: HostClock.nowMs())
    }
}
