import Foundation
import Testing
import OmniCore
import OmniInput
@testable import OmniSim

struct PresetLibraryTests {
    @Test func listsFourPresets() {
        #expect(PresetLibrary.all.map(\.id) == [
            "airpods-head-pitch", "watch-double-tap", "watch-flick", "pencil-barrel-roll",
        ])
    }

    @Test func everyPresetLoadsAndEveryLinePassesValidator() throws {
        let validator = PacketValidator()
        for preset in PresetLibrary.all {
            let text = try #require(PresetLibrary.jsonl(for: preset.id), "missing \(preset.id)")
            let lines = text.split(whereSeparator: \.isNewline).filter { !$0.allSatisfy(\.isWhitespace) }
            #expect(!lines.isEmpty)
            for line in lines {
                switch validator.decode(Data(line.utf8)) {
                case .success(let packet):
                    #expect(packet.source == .sim)
                case .failure(let error):
                    Issue.record("\(preset.id): \(error) in \(line)")
                }
            }
            let player = try #require(PresetLibrary.player(for: preset.id))
            #expect(player.malformedLineCount == 0)
            #expect(player.packetCount == lines.count)
        }
    }

    @Test func presetsCarryTheirSignatureChannels() throws {
        func packets(_ id: String) throws -> [UsisPacket] {
            let text = try #require(PresetLibrary.jsonl(for: id))
            return text.split(whereSeparator: \.isNewline).compactMap {
                try? JSONDecoder().decode(UsisPacket.self, from: Data($0.utf8))
            }
        }
        #expect(try packets("airpods-head-pitch").allSatisfy { $0.kind == .airpods && $0.slot == .head })
        #expect(try packets("watch-double-tap").contains { $0.ch.gesture?.type == .doubleTap })
        #expect(try packets("watch-flick").contains { $0.ch.gesture?.type == .flick && $0.ch.gesture?.dir != nil })
        #expect(try packets("pencil-barrel-roll").allSatisfy { $0.ch.pencil != nil })
    }

    @Test func unknownPresetIsNil() {
        #expect(PresetLibrary.url(for: "nope") == nil)
        #expect(PresetLibrary.player(for: "nope") == nil)
    }
}
