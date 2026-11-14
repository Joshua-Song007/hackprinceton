import Testing
@testable import OmniLibrary

struct DeviceProfileTests {
    @Test func eachKindMapsToItsSensorsAndTier() {
        for kind in DeviceProfile.Kind.allCases {
            let profile = DeviceProfile(kind: kind, model: "m", osVersion: "1")
            #expect(profile.maxTier == 1, "\(kind)")
            switch kind {
            case .iPhone, .iPad: #expect(profile.sensors == [.display, .touch, .motion], "\(kind)")
            case .mac: #expect(profile.sensors == [.display])
            }
        }
    }

    @Test func maxTierIsClamped() {
        for (given, expected) in [(0, 1), (-3, 1), (1, 1), (2, 2), (3, 3), (9, 3)] {
            let profile = DeviceProfile(kind: .iPhone, model: "m", osVersion: "1", sensors: [.display], maxTier: given)
            #expect(profile.maxTier == expected, "maxTier \(given)")
        }
    }

    @Test func customSensorsAreKept() {
        let profile = DeviceProfile(kind: .mac, model: "m", osVersion: "1", sensors: [.display, .motion], maxTier: 2)
        #expect(profile.sensors == [.display, .motion])
        #expect(profile.maxTier == 2)
    }

    @Test func kindFromMachineString() {
        #expect(DeviceProfile.kind(forMachine: "iPhone16,1", isMac: false) == .iPhone)
        #expect(DeviceProfile.kind(forMachine: "iPad14,3", isMac: false) == .iPad)
        #expect(DeviceProfile.kind(forMachine: "iPod9,1", isMac: false) == .iPhone)
        #expect(DeviceProfile.kind(forMachine: "arm64", isMac: false) == .iPhone)
        #expect(DeviceProfile.kind(forMachine: "Mac14,2", isMac: true) == .mac)
        // The platform wins over the string.
        #expect(DeviceProfile.kind(forMachine: "iPad14,3", isMac: true) == .mac)
    }

    #if os(macOS)
    @Test func currentOnMac() {
        let profile = DeviceProfile.current()
        #expect(profile.kind == .mac)
        #expect(!profile.model.isEmpty)
        #expect(!profile.osVersion.isEmpty)
        #expect(profile.sensors == [.display])
        #expect(profile.maxTier == 1)
    }
    #endif
}
