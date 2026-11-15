import Foundation
import Testing
@testable import PearCloud

// Ports Web/studio/test/media.test.ts (crop math, guidelines, parse) against GameMedia.swift.
struct GameMediaTests {
    static func item(_ name: String) -> MediaItem {
        MediaItem(name: name, sha256: String(repeating: "a", count: 64), size: 5, contentType: "image/png", width: 1920, height: 1080, caption: "c")
    }

    @Test func autoCropIsLargestCenteredRectOfTheAspect() {
        let c = Crop.auto(imgW: 2000, imgH: 1000, aspect: 1)
        #expect(c == Crop(x: 0.25, y: 0, w: 0.5, h: 1))
        let t = Crop.auto(imgW: 1000, imgH: 2000, aspect: 2)
        #expect(t.w == 1)
        #expect(abs(t.h - 0.25) < 1e-9)
        #expect(abs(t.y - 0.375) < 1e-9)
    }

    @Test func everyAutoCropHasTheSurfaceAspectInPixels() {
        for s in MediaSurface.allCases {
            let c = Crop.auto(imgW: 1920, imgH: 1080, aspect: s.aspect)
            #expect(abs((c.w * 1920) / (c.h * 1080) - s.aspect) < 1e-6)
            #expect(c.isValid)
        }
    }

    @Test func zoomShrinksAboutCenterClampedAndZoomInverts() {
        let aspect = 16.0 / 9
        let base = Crop.auto(imgW: 1920, imgH: 1080, aspect: aspect)
        let z = base.zoomed(imgW: 1920, imgH: 1080, aspect: aspect, to: 2)
        #expect(abs(z.w - 0.5) < 1e-9)
        #expect(abs(z.zoom(imgW: 1920, imgH: 1080, aspect: aspect) - 2) < 1e-9)
        #expect(abs(Crop.rect(imgW: 1920, imgH: 1080, aspect: aspect, zoom: 99).w - 1 / MediaRules.maxZoom) < 1e-9)
        #expect(Crop.rect(imgW: 1920, imgH: 1080, aspect: aspect, zoom: 0.1).w == 1)
    }

    @Test func movingNeverLeavesTheImage() {
        let c = Crop.rect(imgW: 2000, imgH: 1000, aspect: 1, zoom: 2)
        let near = c.moved(dx: -5, dy: -5)
        #expect(near.x == 0 && near.y == 0)
        let far = c.moved(dx: 5, dy: 5)
        #expect(abs(far.x + far.w - 1) < 1e-9)
        #expect(abs(far.y + far.h - 1) < 1e-9)
    }

    @Test func validCropRejectsMalformedRectangles() {
        #expect(!Crop(x: 0.5, y: 0, w: 0.6, h: 1).isValid)
        #expect(!Crop(x: 0, y: 0, w: 0, h: 1).isValid)
        #expect(!Crop(x: .nan, y: 0, w: 0.5, h: 1).isValid)
        #expect(Crop(x: 0, y: 0, w: 1, h: 1).isValid)
    }

    @Test func guidelinesAcceptBigJpegAndNameEachProblem() {
        #expect(MediaRules.problem(type: "image/jpeg", size: 1000, width: 1920, height: 1080) == nil)
        #expect(MediaRules.problem(type: "image/gif", size: 1000, width: 1920, height: 1080)?.contains("JPEG or PNG") == true)
        #expect(MediaRules.problem(type: "image/png", size: 11 * 1024 * 1024, width: 1920, height: 1080)?.contains("10 MB") == true)
        #expect(MediaRules.problem(type: "image/png", size: 1000, width: 800, height: 600)?.contains("1280 x 720") == true)
    }

    @Test func missingReportsWhatIsAbsent() {
        #expect(GameMedia().missing == ["No thumbnail.", "No carousel images."])
        #expect(GameMedia(thumbnail: Self.item("t.png"), carousel: [Self.item("a.png")]).missing.isEmpty)
    }

    @Test func parseDropsMalformedItems() {
        let good = GameMedia(carousel: [Self.item("a.png")]).json
        guard case .object(let goodObj) = good, case .array(let list)? = goodObj["carousel"] else {
            Issue.record("media json shape")
            return
        }
        let value: JSONValue = .object([
            "thumbnail": .object(["name": .string("x")]),
            "carousel": .array(list + [.object(["nope": .number(1)])]),
        ])
        let parsed = GameMedia.parse(value)
        #expect(parsed.thumbnail == nil)
        #expect(parsed.carousel.map(\.name) == ["a.png"])
        #expect(GameMedia.parse(nil).isEmpty)
        #expect(GameMedia.parse(.string("junk")).isEmpty)
    }

    @Test func jsonRoundTripsAndAssetNamesMatchServerPattern() {
        let media = GameMedia(thumbnail: Self.item("t.png"), carousel: [Self.item("a.png")])
        #expect(GameMedia.parse(media.json) == media)
        let name = MediaItem.assetName(thumbnail: true, now: Date(timeIntervalSince1970: 1234))
        #expect(name.range(of: #"^[A-Za-z0-9._-]{1,128}$"#, options: .regularExpression) != nil)
    }
}
