import Foundation
import OmniCloud
import OmniRuntime

/// A game ready to run: its scene plus client and server script sources by name.
struct LoadedGame {
    var scene: SceneDescription
    var clientScripts: [String: String]
    var serverScripts: [(name: String, source: String)]
}

/// Reads a game from a folder on disk (`scene.json` + `scripts/<name>.js`) or from a published cloud bundle.
@MainActor
enum GameLoader {
    struct MissingScript: Error, CustomStringConvertible {
        let path: String
        var description: String { "Missing script \(path)" }
    }

    static func fromDirectory(_ dir: URL) throws -> LoadedGame {
        let scene = try SceneLoader.decode(Data(contentsOf: dir.appendingPathComponent("scene.json")))
        func read(_ name: String) throws -> String {
            let url = dir.appendingPathComponent("scripts").appendingPathComponent("\(name).js")
            guard let source = try? String(contentsOf: url, encoding: .utf8) else { throw MissingScript(path: url.path) }
            return source
        }
        var client: [String: String] = [:]
        for name in scene.clientScripts { client[name] = try read(name) }
        let server = try scene.serverScripts.map { (name: $0, source: try read($0)) }
        return LoadedGame(scene: scene, clientScripts: client, serverScripts: server)
    }

    static func fromBundle(_ bundle: GameBundle) throws -> LoadedGame {
        let scene = try SceneLoader.decode(JSONEncoder().encode(bundle.scene))
        var client: [String: String] = [:]
        for script in bundle.clientScripts { client[script.name] = script.source }
        return LoadedGame(
            scene: scene, clientScripts: client, serverScripts: bundle.serverScripts.map { ($0.name, $0.source) })
    }

    /// `OMNI_GAME_DIR`, else `Games/Flagship` in the current directory, any ancestor of the app bundle, or any ancestor
    /// of this source file (a dev build launched from Xcode runs from DerivedData, outside the repo).
    // ponytail: same walk as DemoMode.defaultRecordingURL, copied rather than shared; merge if a third caller appears.
    static func defaultFlagshipURL() -> URL? {
        let fm = FileManager.default
        if let path = ProcessInfo.processInfo.environment["OMNI_GAME_DIR"], fm.fileExists(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        for start in [URL(fileURLWithPath: fm.currentDirectoryPath), Bundle.main.bundleURL, URL(fileURLWithPath: #filePath)] {
            var dir = start
            for _ in 0..<12 {
                let candidate = dir.appendingPathComponent("Games/Flagship")
                if fm.fileExists(atPath: candidate.appendingPathComponent("scene.json").path) { return candidate }
                let parent = dir.deletingLastPathComponent()
                if parent == dir { break }
                dir = parent
            }
        }
        return nil
    }
}
