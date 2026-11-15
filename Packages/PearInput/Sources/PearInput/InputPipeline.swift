import Foundation
import PearCore
import Synchronization

/// Ingest → validate → clock-convert → buffer; per frame sample → calibrate → `InputFrame` with `source` stripped.
public final class InputPipeline: InputBus {
    private struct DeviceState: Sendable {
        var buffer: JitterBuffer
        var clock: ClockSync
        var stats: DeviceStats
    }

    private struct State: Sendable {
        var devices: [String: DeviceState] = [:]
        /// Ping results that arrive before a device's first packet.
        var pendingClocks: [String: ClockSync] = [:]
        var calibration = Calibration()
        var unattributedErrors = 0
        var rejectedDevices = 0
        var delayMs: Double
    }

    private let state: Mutex<State>
    private let validator: PacketValidator
    private let staleAfterMs: Double
    private let maxDevices: Int
    private let clock: @Sendable () -> Double

    public init(
        delayMs: Double = 50,
        staleAfterMs: Double = 500,
        maxDevices: Int = 16,
        validator: PacketValidator = PacketValidator(),
        clock: @escaping @Sendable () -> Double = HostClock.nowMs
    ) {
        self.state = Mutex(State(delayMs: delayMs))
        self.validator = validator
        self.staleAfterMs = staleAfterMs
        self.maxDevices = maxDevices
        self.clock = clock
    }

    /// Jitter-buffer delay D in ms; tunable at runtime.
    public var delayMs: Double {
        get { state.withLock { $0.delayMs } }
        set { state.withLock { $0.delayMs = newValue } }
    }

    public var unattributedErrorCount: Int {
        state.withLock { $0.unattributedErrors }
    }

    public var rejectedDeviceCount: Int {
        state.withLock { $0.rejectedDevices }
    }

    // MARK: InputBus

    public func ingest(json: Data) {
        switch validator.decode(json) {
        case .success(let packet):
            accept(packet)
        case .failure:
            countError(deviceId: Self.deviceId(in: json))
        }
    }

    public func ingest(_ packet: UsisPacket) {
        if validator.validate(packet) != nil {
            countError(deviceId: packet.deviceId)
        } else {
            accept(packet)
        }
    }

    public func recordClockSample(deviceId: String, tSendDevice: Double, tHostReceived: Double, tRecvDevice: Double) {
        guard !deviceId.isEmpty, deviceId.count <= PacketValidator.maxDeviceIdLength else { return }
        state.withLock { s in
            if s.devices[deviceId] != nil {
                s.devices[deviceId]!.clock.addSample(tSend: tSendDevice, tHost: tHostReceived, tRecv: tRecvDevice)
            } else if s.pendingClocks[deviceId] != nil || s.pendingClocks.count < maxDevices {
                s.pendingClocks[deviceId, default: ClockSync()]
                    .addSample(tSend: tSendDevice, tHost: tHostReceived, tRecv: tRecvDevice)
            }
        }
    }

    public func frame(at hostNowMs: Double) -> InputFrame {
        state.withLock { s in
            let renderTime = hostNowMs - s.delayMs
            var samples: [DeviceSample] = []
            for id in s.devices.keys.sorted() {
                var sample = s.devices[id]!.buffer.sample(
                    renderTimeMs: renderTime,
                    nowMs: hostNowMs,
                    staleAfterMs: staleAfterMs
                )
                if let raw = sample.orientation {
                    sample.orientation = s.calibration.apply(deviceId: id, to: raw)
                }
                s.devices[id]!.stats.setStale(sample.stale)
                samples.append(sample)
            }
            return InputFrame(timestamp: hostNowMs, devices: samples)
        }
    }

    // MARK: Studio-facing (concrete only)

    /// Captures the device's newest raw orientation as "facing forward". Returns false if the device is unknown or has none yet.
    @discardableResult
    public func calibrate(deviceId: String, mode: CalibrationMode? = nil) -> Bool {
        state.withLock { s in
            guard let device = s.devices[deviceId], let raw = device.buffer.latestOrientation else { return false }
            s.calibration.capture(deviceId: deviceId, kind: device.buffer.kind, rawOrientation: raw, mode: mode)
            return true
        }
    }

    public func resetCalibration(deviceId: String) {
        state.withLock { $0.calibration.reset(deviceId: deviceId) }
    }

    public func statsSnapshot() -> [DeviceStats] {
        state.withLock { s in
            s.devices.keys.sorted().map { s.devices[$0]!.stats }
        }
    }

    // MARK: Internals

    private func accept(_ p: UsisPacket) {
        let arrival = clock()
        state.withLock { s in
            let id = p.deviceId
            if s.devices[id] == nil {
                guard s.devices.count < maxDevices else {
                    s.rejectedDevices += 1
                    return
                }
                s.devices[id] = DeviceState(
                    buffer: JitterBuffer(deviceId: id, kind: p.kind, slot: p.slot),
                    clock: s.pendingClocks.removeValue(forKey: id) ?? ClockSync(),
                    stats: DeviceStats(deviceId: id, kind: p.kind, slot: p.slot, source: p.source)
                )
            }
            if !s.devices[id]!.clock.isSynced && !s.devices[id]!.clock.hasAnchor {
                s.devices[id]!.clock.anchor(deviceMs: Double(p.t), hostMs: arrival)
            }
            let converted = s.devices[id]!.clock.toHost(Double(p.t))
            let synced = s.devices[id]!.clock.isSynced
            s.devices[id]!.buffer.kind = p.kind
            s.devices[id]!.buffer.slot = p.slot
            s.devices[id]!.stats.record(packet: p, arrivalHostMs: arrival, convertedHostMs: converted, clockSynced: synced)
            s.devices[id]!.buffer.push(hostTimeMs: converted, arrivalMs: arrival, channels: p.ch)
        }
    }

    /// Schema errors count against a device only if it is already tracked, so garbage cannot create entries.
    private func countError(deviceId: String?) {
        state.withLock { s in
            if let id = deviceId, s.devices[id] != nil {
                s.devices[id]!.stats.recordSchemaError()
            } else {
                s.unattributedErrors += 1
            }
        }
    }

    private static func deviceId(in json: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: json) as? [String: Any] else { return nil }
        return object["deviceId"] as? String
    }
}
