import Foundation
import Testing
@testable import PearCloud

// An extension of CloudClientTests so these share its serialized suite (and `StubProtocol`'s shared statics).
extension CloudClientTests {
    static func mediaItem(_ name: String, sha: Character = "a") -> MediaItem {
        MediaItem(name: name, sha256: String(repeating: sha, count: 64), size: 5, contentType: "image/png", width: 1920, height: 1080)
    }

    static func jsonText(_ v: JSONValue) -> String {
        String(decoding: (try? JSONEncoder().encode(v)) ?? Data(), as: UTF8.self)
    }

    /// A version whose assets are given as raw JSON text.
    static func versionJSON(assets: String, metadata: String) -> Data {
        Data(#"""
        {"id":"v","game_id":"g1","version":4,"scene":{"entities":[1,null]},
         "client_scripts":{"enemy":"x"},"server_scripts":{"game":"y"},
         "assets":\#(assets),"metadata":\#(metadata),"run_mode":"device","published_at":"t"}
        """#.utf8)
    }

    @Test func accountRoleDecodesAndDefaultsToNil() async throws {
        let withRole = makeClient { _ in
            (200, Data(#"{"id":"a1","display_name":"Ada","role":"developer"}"#.utf8))
        }
        let dev = try await withRole.signIn(token: "t")
        #expect(dev.role == "developer")
        #expect(dev.isDeveloper)
        let without = makeClient { _ in (200, Data(Self.accountJSON.utf8)) }
        let plain = try await without.signIn(token: "t")
        #expect(plain.role == nil)
        #expect(!plain.isDeveloper)
    }

    @Test func refFormVersionDecodesAndMediaImageIsSkipped() async throws {
        let media = GameMedia(thumbnail: Self.mediaItem("thumb.png"))
        let assets = #"""
        {"a.png":{"contentType":"image/png","data":"AQID"},
         "thumb.png":{"sha256":"\#(String(repeating: "a", count: 64))","size":5,"content_type":"image/png"}}
        """#
        let client = makeClient { req in
            req.url?.path == Self.signInPath ? (200, Self.signInBody)
                : (200, Self.versionJSON(assets: assets, metadata: #"{"title":"T","media":\#(Self.jsonText(media.json))}"#))
        }
        try await client.signInDev(name: "Ada")
        let game = try await client.fetchGame(id: "g1")
        #expect(game.bundle.assets == [AssetFile(name: "a.png", contentType: "image/png", data: Data([1, 2, 3]))])
        #expect(StubProtocol.seen.count == 2)
    }

    @Test func nonMediaRefAssetIsFetchedAndSortedIn() async throws {
        let sha = String(repeating: "c", count: 64)
        let assets = #"""
        {"z.png":{"contentType":"image/png","data":"AQID"},
         "ui.json":{"sha256":"\#(sha)","size":2,"content_type":"application/json"}}
        """#
        let client = makeClient { req in
            switch req.url?.path {
            case Self.signInPath: return (200, Self.signInBody)
            case "/api/assets/\(sha)": return (200, Data("{}".utf8))
            default: return (200, Self.versionJSON(assets: assets, metadata: #"{"title":"T"}"#))
            }
        }
        try await client.signInDev(name: "Ada")
        let game = try await client.fetchGame(id: "g1")
        #expect(game.bundle.assets.map(\.name) == ["ui.json", "z.png"])
        #expect(game.bundle.assets[0] == AssetFile(name: "ui.json", contentType: "application/json", data: Data("{}".utf8)))
        let asset = try #require(StubProtocol.seen.last)
        #expect(asset.url?.path == "/api/assets/\(sha)")
        #expect(asset.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func fetchMediaParsesMetadata() async throws {
        let media = GameMedia(thumbnail: Self.mediaItem("t.png"), carousel: [Self.mediaItem("c.png")])
        let client = makeClient { req in
            req.url?.path == Self.signInPath ? (200, Self.signInBody)
                : (200, Self.versionJSON(assets: "{}", metadata: #"{"media":\#(Self.jsonText(media.json))}"#))
        }
        try await client.signInDev(name: "Ada")
        #expect(try await client.fetchMedia(gameId: "g1") == media)
        #expect(StubProtocol.seen[1].url?.path == "/api/games/g1/versions/latest")
        _ = try await client.fetchMedia(gameId: "g1", version: 3)
        #expect(StubProtocol.seen[2].url?.path == "/api/games/g1/versions/3")
    }

    @Test func publishMediaKeepsGameAndSwapsMediaRefs() async throws {
        let old = GameMedia(thumbnail: Self.mediaItem("old.png", sha: "b"))
        let assets = #"""
        {"a.png":{"contentType":"image/png","data":"AQID"},
         "old.png":{"sha256":"\#(String(repeating: "b", count: 64))","size":5,"content_type":"image/png"},
         "ui.json":{"sha256":"\#(String(repeating: "c", count: 64))","size":2,"content_type":"application/json"}}
        """#
        let latest = Self.versionJSON(assets: assets, metadata: #"{"title":"T","media":\#(Self.jsonText(old.json))}"#)
        let client = makeClient { req in
            req.url?.path == Self.signInPath ? (200, Self.signInBody)
                : (req.httpMethod == "POST" ? (201, Self.versionJSON(game: "g1", version: 5)) : (200, latest))
        }
        try await client.signInDev(name: "Ada")
        let fresh = GameMedia(thumbnail: Self.mediaItem("new.png", sha: "d"))
        #expect(try await client.publishMedia(gameId: "g1", media: fresh) == PublishedVersion(gameId: "g1", version: 5))
        #expect(StubProtocol.seen[1].httpMethod == "GET")
        #expect(StubProtocol.seen[1].url?.path == "/api/games/g1/versions/latest")
        let post = StubProtocol.seen[2]
        #expect(post.httpMethod == "POST")
        #expect(post.url?.path == "/api/games/g1/versions")
        let sent = try #require(try JSONSerialization.jsonObject(with: post.httpBody ?? Data()) as? [String: Any])
        #expect(sent["game_id"] == nil)
        #expect(sent["version"] == nil)
        #expect(sent["run_mode"] as? String == "device")
        #expect(sent["client_scripts"] as? [String: String] == ["enemy": "x"])
        #expect(sent["server_scripts"] as? [String: String] == ["game": "y"])
        #expect(sent["scene"] is [String: Any])
        let sentAssets = try #require(sent["assets"] as? [String: [String: Any]])
        #expect(Set(sentAssets.keys) == ["a.png", "ui.json", "new.png"])
        #expect(sentAssets["a.png"]?["data"] as? String == "AQID")
        #expect(sentAssets["new.png"]?["sha256"] as? String == String(repeating: "d", count: 64))
        #expect(sentAssets["new.png"]?["content_type"] as? String == "image/png")
        let meta = try #require(sent["metadata"] as? [String: Any])
        #expect(meta["title"] as? String == "T")
        let thumb = try #require((meta["media"] as? [String: Any])?["thumbnail"] as? [String: Any])
        #expect(thumb["name"] as? String == "new.png")
    }

    @Test func uploadAssetAndSetCoverUseRawPuts() async throws {
        let client = makeClient { req in
            switch req.url?.path {
            case Self.signInPath: return (200, Self.signInBody)
            case "/api/games/g1/cover": return (204, Data())
            default:
                return (200, Data(#"{"name":"m.png","sha256":"\#(String(repeating: "e", count: 64))","size":3,"content_type":"image/png"}"#.utf8))
            }
        }
        try await client.signInDev(name: "Ada")
        let stored = try await client.uploadAsset(gameId: "g1", name: "m.png", data: Data([9, 8, 7]), contentType: "image/png")
        #expect(stored == StoredAsset(name: "m.png", sha256: String(repeating: "e", count: 64), size: 3, contentType: "image/png"))
        let up = StubProtocol.seen[1]
        #expect(up.httpMethod == "PUT")
        #expect(up.url?.path == "/api/games/g1/assets/m.png")
        #expect(up.value(forHTTPHeaderField: "Content-Type") == "image/png")
        #expect(up.httpBody == Data([9, 8, 7]))

        try await client.setCover(gameId: "g1", data: Data([1]))
        let cover = StubProtocol.seen[2]
        #expect(cover.httpMethod == "PUT")
        #expect(cover.url?.path == "/api/games/g1/cover")
        #expect(cover.value(forHTTPHeaderField: "Content-Type") == "image/jpeg")
        #expect(cover.httpBody == Data([1]))
    }

    @Test func ownedGameIdsAndAssetURL() async throws {
        let client = makeClient { req in
            req.url?.path == Self.signInPath ? (200, Self.signInBody) : (200, Data(#"""
                [{"id":"g1","owner_id":"a1","title":"T","created_at":"t","updated_at":"t"},
                 {"id":"g2","title":"D"}]
                """#.utf8))
        }
        try await client.signInDev(name: "Ada")
        #expect(try await client.ownedGameIds() == ["g1", "g2"])
        #expect(client.assetURL(sha256: "abc").absoluteString == "https://pear.test/api/assets/abc")
    }
}
