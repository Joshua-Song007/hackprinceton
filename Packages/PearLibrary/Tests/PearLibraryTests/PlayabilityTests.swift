import PearCloud
import Testing
@testable import PearLibrary

struct PlayabilityTests {
    func entry(mode: String, tier: Int) -> CatalogEntry {
        CatalogEntry(id: "g", title: "T", author: "A", latestVersion: 1, runMode: mode, requiredTier: tier)
    }

    func profile(_ kind: DeviceProfile.Kind) -> DeviceProfile {
        DeviceProfile(kind: kind, model: "m", osVersion: "1")
    }

    // The full matrix: 3 device kinds x 2 run modes x tiers 1...3, written out, not recomputed.
    @Test func everyKindRunModeAndTier() {
        let matrix: [(DeviceProfile.Kind, String, Int, Playability)] = [
            (.iPhone, "device", 1, .playable), (.iPhone, "device", 2, .needsTier(2)), (.iPhone, "device", 3, .needsTier(3)),
            (.iPhone, "screen", 1, .playable), (.iPhone, "screen", 2, .needsTier(2)), (.iPhone, "screen", 3, .needsTier(3)),
            (.iPad, "device", 1, .needsPhone), (.iPad, "device", 2, .needsPhone), (.iPad, "device", 3, .needsPhone),
            (.iPad, "screen", 1, .playable), (.iPad, "screen", 2, .needsTier(2)), (.iPad, "screen", 3, .needsTier(3)),
            (.mac, "device", 1, .needsPhone), (.mac, "device", 2, .needsPhone), (.mac, "device", 3, .needsPhone),
            (.mac, "screen", 1, .needsController), (.mac, "screen", 2, .needsController), (.mac, "screen", 3, .needsController),
        ]
        #expect(matrix.count == 18)
        for (kind, mode, tier, expected) in matrix {
            let actual = Playability.evaluate(entry(mode: mode, tier: tier), on: profile(kind))
            #expect(actual == expected, "\(kind) \(mode) tier \(tier): got \(actual)")
        }
    }

    @Test func tierBelowOneCountsAsOne() {
        #expect(Playability.evaluate(entry(mode: "device", tier: 0), on: profile(.iPhone)) == .playable)
        #expect(Playability.evaluate(entry(mode: "screen", tier: -4), on: profile(.iPad)) == .playable)
    }

    @Test func unknownRunModeBehavesAsScreen() {
        #expect(Playability.evaluate(entry(mode: "vr", tier: 1), on: profile(.iPhone)) == .playable)
        #expect(Playability.evaluate(entry(mode: "vr", tier: 1), on: profile(.mac)) == .needsController)
        #expect(Playability.evaluate(entry(mode: "", tier: 1), on: profile(.iPad)) == .playable)
    }

    @Test func screenGameNeedsDisplayThenController() {
        let headless = DeviceProfile(kind: .iPhone, model: "m", osVersion: "1", sensors: [.motion, .touch], maxTier: 3)
        #expect(Playability.evaluate(entry(mode: "screen", tier: 1), on: headless) == .needsDisplay)
        let displayOnly = DeviceProfile(kind: .iPad, model: "m", osVersion: "1", sensors: [.display], maxTier: 3)
        #expect(Playability.evaluate(entry(mode: "screen", tier: 1), on: displayOnly) == .needsController)
        let touchOnly = DeviceProfile(kind: .iPad, model: "m", osVersion: "1", sensors: [.display, .touch], maxTier: 1)
        #expect(Playability.evaluate(entry(mode: "screen", tier: 1), on: touchOnly) == .playable)
        let motionOnly = DeviceProfile(kind: .iPad, model: "m", osVersion: "1", sensors: [.display, .motion], maxTier: 1)
        #expect(Playability.evaluate(entry(mode: "screen", tier: 1), on: motionOnly) == .playable)
        // No display and no controller: the display check comes first.
        let nothing = DeviceProfile(kind: .mac, model: "m", osVersion: "1", sensors: [], maxTier: 1)
        #expect(Playability.evaluate(entry(mode: "screen", tier: 1), on: nothing) == .needsDisplay)
    }

    @Test func higherMaxTierUnlocksHigherGames() {
        let lidar = DeviceProfile(kind: .iPhone, model: "m", osVersion: "1", sensors: [.display, .touch, .motion], maxTier: 3)
        for tier in 1...3 {
            #expect(Playability.evaluate(entry(mode: "device", tier: tier), on: lidar) == .playable)
        }
        let two = DeviceProfile(kind: .iPhone, model: "m", osVersion: "1", sensors: [.display, .touch, .motion], maxTier: 2)
        #expect(Playability.evaluate(entry(mode: "device", tier: 2), on: two) == .playable)
        #expect(Playability.evaluate(entry(mode: "device", tier: 3), on: two) == .needsTier(3))
    }

    @Test func checkOrderIsPhoneThenControllerThenTier() {
        // A tier-3 game: the run-mode problem is reported before the tier problem.
        #expect(Playability.evaluate(entry(mode: "device", tier: 3), on: profile(.mac)) == .needsPhone)
        #expect(Playability.evaluate(entry(mode: "screen", tier: 3), on: profile(.mac)) == .needsController)
    }

    @Test func isPlayableOnlyForPlayable() {
        #expect(Playability.playable.isPlayable)
        for other in [Playability.needsController, .needsPhone, .needsDisplay, .needsTier(2)] {
            #expect(!other.isPlayable)
        }
    }
}
