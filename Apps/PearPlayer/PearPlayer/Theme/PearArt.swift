import SwiftUI

/// Generated art for games and people: the catalog has no cover images or avatars yet, so each one is drawn from
/// a stable hash of its id or name. Same input, same picture, on every launch and device.
enum PearArt {
    /// FNV-1a; `String.hashValue` is seeded per launch, so it cannot be used here.
    static func hash(_ text: String) -> UInt64 {
        var h: UInt64 = 0xcbf29ce484222325
        for byte in text.utf8 {
            h ^= UInt64(byte)
            h = h &* 0x100000001b3
        }
        return h
    }

    /// Dark, mid, light stops, from the kit's locked palette and its derived inks only. The light stop is always
    /// Tea, Sandy or Powder, so Ink text on it is AAA.
    static let palettes: [[UInt32]] = [
        [0x0F2A1F, 0x285943, 0xC2EFB3], // Ink, Emerald, Tea
        [0x0F2A1F, 0x764134, 0xE5B181], // Ink, Clay, Sandy
        [0x0F2A1F, 0x1F4F7A, 0xA7BED3], // Ink, Powder 700, Powder
        [0x285943, 0x764134, 0xE5B181], // Emerald, Clay, Sandy
        [0x764134, 0x285943, 0xA7BED3], // Clay, Emerald, Powder
        [0x0F2A1F, 0x285943, 0xE5B181], // Ink, Emerald, Sandy
    ]

    static let symbols = [
        "sparkles", "bolt.fill", "leaf.fill", "flame.fill", "moon.stars.fill",
        "waveform", "cube.fill", "star.fill", "globe.americas.fill", "music.note",
    ]

    static func palette(_ seed: String) -> [Color] {
        palettes[Int(hash(seed) % UInt64(palettes.count))].map { Color(hex: $0) }
    }
}

/// A game cover: a mesh gradient in one of the Pear palettes with a large decorative symbol.
struct CoverArt: View {
    let seed: String
    /// The game's real cover picture; the generated art below shows while it loads, fails, or when nil.
    var url: URL?

    var body: some View {
        let h = PearArt.hash(seed)
        let c = PearArt.palette(seed)
        // Nudge the middle point so covers that share a palette still differ.
        let mx = 0.3 + Float(h % 40) / 100
        let my = 0.3 + Float((h >> 8) % 40) / 100
        MeshGradient(
            width: 3, height: 3,
            points: [
                [0, 0], [0.5, 0], [1, 0],
                [0, 0.5], [mx, my], [1, 0.5],
                [0, 1], [0.5, 1], [1, 1],
            ],
            colors: h & 1 == 0
                ? [c[0], c[0], c[1], c[0], c[1], c[2], c[1], c[2], c[2]]
                : [c[1], c[0], c[0], c[2], c[1], c[0], c[2], c[2], c[1]]
        )
        .overlay { PosterMotif(hash: h, colors: c) }
        .overlay {
            if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                }
            }
        }
        .clipped()
        .accessibilityHidden(true)
    }
}

/// The cover's figure: a lit orb with motion rings around it (Pear games read movement), placed by the hash.
private struct PosterMotif: View {
    let hash: UInt64
    let colors: [Color]

    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height)
            // Wide art (heroes) keeps the figure right of centre so the title on the left stays clear.
            let wide = geo.size.width > geo.size.height * 1.3
            let x = geo.size.width * ((wide ? 0.68 : 0.4) + Double((hash >> 24) % (wide ? 15 : 30)) / 100)
            let y = geo.size.height * (0.3 + Double((hash >> 32) % 20) / 100)
            ZStack {
                ForEach(1..<4) { i in
                    Circle()
                        .strokeBorder(colors[2].opacity(0.42 - Double(i) * 0.1), lineWidth: 1.5)
                        .frame(width: s * (0.5 + 0.32 * Double(i)), height: s * (0.5 + 0.32 * Double(i)))
                }
                Circle()
                    .fill(colors[2])
                    .frame(width: s * 0.46, height: s * 0.46)
                    .shadow(color: PearTheme.ink.opacity(0.45), radius: s * 0.08, y: s * 0.05)
                Image(systemName: PearArt.symbols[Int((hash >> 16) % UInt64(PearArt.symbols.count))])
                    .resizable()
                    .scaledToFit()
                    .frame(width: s * 0.2, height: s * 0.2)
                    .foregroundStyle(colors[0])
            }
            .position(x: x, y: y)
        }
    }
}

/// Where profile pictures load from, set once at the root. `version` changes when the signed-in player uploads or
/// removes their own picture, so the image reloads.
struct AvatarSource: Sendable {
    var version = 0
    let make: @Sendable (String) -> URL

    func url(for accountId: String) -> URL {
        var parts = URLComponents(url: make(accountId), resolvingAgainstBaseURL: false)
        parts?.queryItems = [URLQueryItem(name: "v", value: String(version))]
        return parts?.url ?? make(accountId)
    }
}

private struct AvatarSourceKey: EnvironmentKey {
    static let defaultValue: AvatarSource? = nil
}

extension EnvironmentValues {
    var avatarSource: AvatarSource? {
        get { self[AvatarSourceKey.self] }
        set { self[AvatarSourceKey.self] = newValue }
    }
}

/// A round avatar: the player's picture when `accountId` has one, else Ink initials on Tea, Sandy or Powder.
struct AvatarView: View {
    let name: String
    var size: CGFloat = 40
    var accountId: String?
    @Environment(\.avatarSource) private var source

    private var initials: String {
        let words = name.split(separator: " ").prefix(2)
        let letters = words.compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }

    var body: some View {
        let c = PearArt.palette(name)
        Circle()
            .fill(c[2])
            .overlay {
                Text(initials)
                    .font(.custom("Figtree-Bold", size: size * 0.38))
                    .foregroundStyle(PearTheme.ink)
            }
            .overlay {
                // No picture (404) or still loading: the initials above stay.
                if let accountId, let source {
                    AsyncImage(url: source.url(for: accountId)) { phase in
                        if let image = phase.image { image.resizable().scaledToFill() }
                    }
                    .clipShape(Circle())
                }
            }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The page backdrop, after Steam's store pages: the game's art, blurred and dimmed behind the top of the page,
/// fading into a canvas that darkens toward the bottom. `seed` nil draws the gradient alone.
struct PearBackdrop: View {
    let seed: String?
    var cover: URL?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        LinearGradient(colors: [PearTheme.bgField, PearTheme.bgDeep], startPoint: .top, endPoint: .bottom)
            .overlay(alignment: .top) {
                if let seed {
                    CoverArt(seed: seed, url: cover)
                        .frame(height: 720)
                        .blur(radius: 70)
                        .opacity(scheme == .dark ? 0.7 : 0.4)
                        .mask(LinearGradient(colors: [.black, .black.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom))
                        .animation(PearTheme.motion, value: seed)
                }
            }
            .ignoresSafeArea()
            .accessibilityHidden(true)
    }
}
