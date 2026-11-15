import Foundation

/// Non-packet messages on the device link. USIS packets travel on the same newline-delimited stream
/// but are not `WireMessage`s; a line with a `msg` key is a wire message, anything else is a packet.
public enum WireMessage: Equatable, Codable, Sendable {
    /// Device to host, first message after connecting.
    case hello(deviceId: String, kind: DeviceKind, name: String, protocolVersion: Int)
    /// Host to device clock-sync probe; `id` is echoed by the matching `pong`.
    case ping(id: Int, hostT: Double)
    /// Device reply to `ping`; `deviceT` is the device clock in ms when the ping arrived.
    case pong(id: Int, deviceT: Double)
    /// Host to device output command.
    case output(OutputCommand)

    private enum CodingKeys: String, CodingKey {
        case msg, deviceId, kind, name, protocolVersion, id, hostT, deviceT, command
    }

    private enum Tag: String, Codable {
        case hello, ping, pong, output
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(Tag.self, forKey: .msg) {
        case .hello:
            self = .hello(
                deviceId: try c.decode(String.self, forKey: .deviceId),
                kind: try c.decode(DeviceKind.self, forKey: .kind),
                name: try c.decode(String.self, forKey: .name),
                protocolVersion: try c.decode(Int.self, forKey: .protocolVersion)
            )
        case .ping:
            self = .ping(id: try c.decode(Int.self, forKey: .id), hostT: try c.decode(Double.self, forKey: .hostT))
        case .pong:
            self = .pong(id: try c.decode(Int.self, forKey: .id), deviceT: try c.decode(Double.self, forKey: .deviceT))
        case .output:
            self = .output(try c.decode(OutputCommand.self, forKey: .command))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .hello(deviceId, kind, name, protocolVersion):
            try c.encode(Tag.hello, forKey: .msg)
            try c.encode(deviceId, forKey: .deviceId)
            try c.encode(kind, forKey: .kind)
            try c.encode(name, forKey: .name)
            try c.encode(protocolVersion, forKey: .protocolVersion)
        case let .ping(id, hostT):
            try c.encode(Tag.ping, forKey: .msg)
            try c.encode(id, forKey: .id)
            try c.encode(hostT, forKey: .hostT)
        case let .pong(id, deviceT):
            try c.encode(Tag.pong, forKey: .msg)
            try c.encode(id, forKey: .id)
            try c.encode(deviceT, forKey: .deviceT)
        case let .output(command):
            try c.encode(Tag.output, forKey: .msg)
            try c.encode(command, forKey: .command)
        }
    }
}
