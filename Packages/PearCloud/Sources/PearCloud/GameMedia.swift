import Foundation

// Game media (14.8): thumbnail + carousel with per-surface crops. A 1:1 port of Web/studio/src/mediaCrop.ts and
// mediaDraft.ts, so a game edited in Studio and on iPhone shares one `metadata.media` format. Keep the two in step.

/// A crop: a rectangle in image space, every field a 0..1 fraction of the image.
public struct Crop: Codable, Sendable, Equatable {
    public var x: Double, y: Double, w: Double, h: Double
    public init(x: Double, y: Double, w: Double, h: Double) {
        self.x = x; self.y = y; self.w = w; self.h = h
    }

    /// Whether this is a usable rectangle inside the image.
    public var isValid: Bool {
        [x, y, w, h].allSatisfy(\.isFinite) && w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9
    }
}

/// Where an image shows up and the aspect ratio (width / height) it is cropped to.
public enum MediaSurface: String, CaseIterable, Sendable {
    case card, hero, carousel, web

    public var label: String {
        switch self {
        case .card: "Home card"
        case .hero: "Hero banner"
        case .carousel: "Detail carousel"
        case .web: "Web page"
        }
    }

    public var aspect: Double {
        switch self {
        case .card: 4.0 / 3
        case .hero: 21.0 / 9
        case .carousel: 16.0 / 9
        case .web: 3.0 / 2
        }
    }
}

public enum MediaRules {
    public static let types = ["image/jpeg", "image/png"]
    /// The server's per-asset limit.
    public static let maxBytes = 10 * 1024 * 1024
    public static let minWidth = 1280
    public static let minHeight = 720
    public static let carouselMax = 8
    /// Fraction of each edge that may be cut by a platform overlay; keep text and faces inside.
    public static let safeInset = 0.05
    public static let maxZoom = 4.0

    public static let guidelines = [
        "Photos of people playing, concept art or rules explainers; not in-game screenshots.",
        "JPEG or PNG, up to \(maxBytes / 1024 / 1024) MB, at least \(minWidth) x \(minHeight) px.",
        "Keep text and faces inside the safe area (\(Int(safeInset * 100))% in from each edge); crops differ per surface.",
        "One thumbnail plus up to \(carouselMax) carousel images.",
    ]

    /// Why an image cannot be used, or nil when it can.
    public static func problem(type: String, size: Int, width: Int, height: Int) -> String? {
        if !types.contains(type) { return "Images must be JPEG or PNG." }
        if size > maxBytes { return "Images must be \(maxBytes / 1024 / 1024) MB or smaller." }
        if width < minWidth || height < minHeight {
            return "Images must be at least \(minWidth) x \(minHeight) px (this one is \(width) x \(height))."
        }
        return nil
    }
}

private func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, v)) }

extension Crop {
    /// The crop of the given aspect centered on (cx, cy), `zoom` (1...maxZoom) times tighter than the largest one that fits.
    public static func rect(
        imgW: Double, imgH: Double, aspect: Double, zoom: Double = 1, cx: Double = 0.5, cy: Double = 0.5
    ) -> Crop {
        let z = clamp(zoom, 1, MediaRules.maxZoom)
        let wide = imgW / imgH > aspect
        let w = (wide ? imgH * aspect / imgW : 1) / z
        let h = (wide ? 1 : imgW / aspect / imgH) / z
        return Crop(x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w: w, h: h)
    }

    /// Largest centered crop: what a surface gets until the developer adjusts it.
    public static func auto(imgW: Double, imgH: Double, aspect: Double) -> Crop {
        rect(imgW: imgW, imgH: imgH, aspect: aspect)
    }

    /// Zoom factor relative to the largest crop of that aspect.
    public func zoom(imgW: Double, imgH: Double, aspect: Double) -> Double {
        Crop.auto(imgW: imgW, imgH: imgH, aspect: aspect).w / w
    }

    /// Moved by a fraction of the image, staying inside it.
    public func moved(dx: Double, dy: Double) -> Crop {
        Crop(x: clamp(x + dx, 0, 1 - w), y: clamp(y + dy, 0, 1 - h), w: w, h: h)
    }

    /// Same center, new zoom.
    public func zoomed(imgW: Double, imgH: Double, aspect: Double, to zoom: Double) -> Crop {
        Crop.rect(imgW: imgW, imgH: imgH, aspect: aspect, zoom: zoom, cx: x + w / 2, cy: y + h / 2)
    }
}

/// One image: a stored asset plus a caption and a crop per surface (`MediaItem` in mediaDraft.ts).
public struct MediaItem: Codable, Sendable, Equatable, Identifiable {
    /// Asset name in the version's `assets`.
    public var name: String
    public var sha256: String
    public var size: Int
    public var contentType: String
    public var width: Int
    public var height: Int
    public var caption: String
    /// Keyed by `MediaSurface.rawValue`.
    public var crops: [String: Crop]

    public var id: String { name }

    public init(
        name: String, sha256: String, size: Int, contentType: String, width: Int, height: Int,
        caption: String = "", crops: [String: Crop]? = nil
    ) {
        self.name = name; self.sha256 = sha256; self.size = size; self.contentType = contentType
        self.width = width; self.height = height; self.caption = caption
        self.crops = crops ?? MediaItem.autoCrops(width: width, height: height)
    }

    private enum CodingKeys: String, CodingKey {
        case name, sha256, size, width, height, caption, crops
        case contentType = "content_type"
    }

    /// A caption is optional on the wire (Studio writes "" but older drafts may omit it).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        sha256 = try c.decode(String.self, forKey: .sha256)
        size = try c.decodeIfPresent(Int.self, forKey: .size) ?? 0
        contentType = try c.decodeIfPresent(String.self, forKey: .contentType) ?? "image/jpeg"
        width = try c.decode(Int.self, forKey: .width)
        height = try c.decode(Int.self, forKey: .height)
        caption = try c.decodeIfPresent(String.self, forKey: .caption) ?? ""
        crops = try c.decode([String: Crop].self, forKey: .crops)
    }

    public static func autoCrops(width: Int, height: Int) -> [String: Crop] {
        Dictionary(uniqueKeysWithValues: MediaSurface.allCases.map {
            ($0.rawValue, Crop.auto(imgW: Double(width), imgH: Double(height), aspect: $0.aspect))
        })
    }

    public func crop(_ surface: MediaSurface) -> Crop {
        crops[surface.rawValue] ?? Crop.auto(imgW: Double(width), imgH: Double(height), aspect: surface.aspect)
    }

    /// Mirrors `isItem` in mediaDraft.ts: positive size and a valid crop for every surface.
    public var isValid: Bool {
        !name.isEmpty && sha256.count == 64 && width > 0 && height > 0
            && MediaSurface.allCases.allSatisfy { crops[$0.rawValue]?.isValid == true }
    }

    /// A unique asset name for a new image (satisfies the server's `[A-Za-z0-9._-]{1,128}`).
    public static func assetName(thumbnail: Bool, index: Int = 0, now: Date = Date()) -> String {
        "media-\(thumbnail ? "thumb" : "img")-\(String(Int(now.timeIntervalSince1970 * 1000), radix: 36))-\(index).jpg"
    }
}

/// The thumbnail and carousel of a game, as `metadata.media` carries them.
public struct GameMedia: Codable, Sendable, Equatable {
    public var thumbnail: MediaItem?
    public var carousel: [MediaItem]
    public init(thumbnail: MediaItem? = nil, carousel: [MediaItem] = []) {
        self.thumbnail = thumbnail
        self.carousel = carousel
    }

    /// Lenient, like `parseMedia`: malformed items are dropped and the carousel is capped.
    public init(from decoder: Decoder) throws {
        struct Lossy: Decodable {
            let item: MediaItem?
            init(from decoder: Decoder) { item = try? MediaItem(from: decoder) }
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        thumbnail = (try? c.decodeIfPresent(Lossy.self, forKey: .thumbnail))?.item.flatMap { $0.isValid ? $0 : nil }
        let list = (try? c.decodeIfPresent([Lossy].self, forKey: .carousel)) ?? []
        carousel = Array(list.compactMap(\.item).filter(\.isValid).prefix(MediaRules.carouselMax))
    }

    public var items: [MediaItem] { (thumbnail.map { [$0] } ?? []) + carousel }
    public var isEmpty: Bool { items.isEmpty }

    /// Sentences naming what is still missing before the game page looks finished; empty when complete.
    public var missing: [String] {
        (thumbnail == nil ? ["No thumbnail."] : []) + (carousel.isEmpty ? ["No carousel images."] : [])
    }

    /// Parses a `metadata.media` value; nil metadata or anything unusable gives an empty value.
    public static func parse(_ value: JSONValue?) -> GameMedia {
        guard let value, let data = try? JSONEncoder().encode(value),
              let media = try? JSONDecoder().decode(GameMedia.self, from: data)
        else { return GameMedia() }
        return media
    }

    /// The `metadata.media` value for a version.
    public var json: JSONValue {
        guard let data = try? JSONEncoder().encode(self),
              let value = try? JSONDecoder().decode(JSONValue.self, from: data)
        else { return .null }
        return value
    }
}
