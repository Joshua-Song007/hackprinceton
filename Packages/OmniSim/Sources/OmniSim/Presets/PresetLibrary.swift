import Foundation

/// Lists and loads the bundled gesture presets (recorded `.usis.jsonl` timelines).
public enum PresetLibrary {
    public struct Preset: Equatable, Sendable, Identifiable {
        /// Resource file name without the `.usis.jsonl` extension.
        public let id: String
        public let title: String
    }

    /// Bundled presets, in display order.
    public static let all: [Preset] = [
        Preset(id: "airpods-head-pitch", title: "AirPods head pitch"),
        Preset(id: "watch-double-tap", title: "Watch double-tap"),
        Preset(id: "watch-flick", title: "Watch flick"),
        Preset(id: "pencil-barrel-roll", title: "Pencil barrel roll"),
    ]

    /// Location of a preset's recording inside the module bundle; nil if the id is unknown or the file is missing.
    public static func url(for id: String) -> URL? {
        guard all.contains(where: { $0.id == id }) else { return nil }
        return Bundle.module.url(forResource: "\(id).usis", withExtension: "jsonl")
            ?? Bundle.module.url(forResource: "\(id).usis", withExtension: "jsonl", subdirectory: "Presets")
    }

    /// Raw `.usis.jsonl` text of a preset; nil if unknown or unreadable.
    public static func jsonl(for id: String) -> String? {
        guard let url = url(for: id) else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    /// A player replaying the preset once (or looped); nil if unknown or unreadable.
    public static func player(for id: String, loop: Bool = false) -> UsisPlayer? {
        guard let text = jsonl(for: id) else { return nil }
        return UsisPlayer(jsonl: text, loop: loop)
    }
}
