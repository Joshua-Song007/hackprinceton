import CoreText
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Colours, metrics and styles for PearPlayer (macOS and iOS). Token names follow `docs/brand-kit`; the colour
/// values are the Player palette (Tea Green C2EFB3, Sandy Clay E5B181, Emerald Depths 285943, Clay Soil 764134,
/// Powder Blue A7BED3 and tints of them), not the Studio kit's greys. Packages never import this.
enum PearTheme {
    // Brand kit semantic tokens (docs/brand-kit/tokens.css): dark = Emerald theme, light = Paper theme.
    static let bgWindow = Color(light: 0xF4FAEF, dark: 0x285943)      // surface-canvas
    static let bgPanel = Color(light: 0xFFFFFF, dark: 0x764134)       // surface-raised (Clay always takes a Sandy border)
    static let bgField = Color(light: 0xF4FAEF, dark: 0x285943)       // surface-canvas
    static let bgDeep = Color(light: 0xDCE9D6, dark: 0x0B1F17)        // bottom of the page backdrop
    static let bgHover = Color(light: 0xF2F5F4, dark: 0x805043)
    static let bgSelected = Color(light: 0xDCE7DA, dark: 0x447457)
    static let line = Color(light: 0xCFDDD0, dark: 0x517971)          // border-subtle
    static let lineControl = Color(light: 0x285943, dark: 0xE5B181)   // border-strong
    static let text = Color(light: 0x0F2A1F, dark: 0xF4FAEF)          // ink-primary
    static let textSecondary = Color(light: 0x285943, dark: 0xC8DCCD) // ink-secondary
    static let accent = Color(light: 0x285943, dark: 0xC2EFB3)
    static let onAccent = Color(light: 0xF4FAEF, dark: 0x285943)
    static let ok = Color(light: 0x285943, dark: 0xC2EFB3)
    static let warnSoft = Color(hex: 0xE5B181)
    static let error = Color(light: 0x9B2F1F, dark: 0xFFB4A3)
    static let warn = Color(light: 0x7A4B12, dark: 0xF0CBA8)          // state-warn

    // Locked palette, same in both themes: badge and tag fills take Ink text.
    static let sandy = Color(hex: 0xE5B181)
    static let powder = Color(hex: 0xA7BED3)
    static let ink = Color(hex: 0x0F2A1F)
    /// Text on cover art: always Paper, over `scrim`.
    static let paper = Color(hex: 0xF4FAEF)
    /// Ink fade under titles on cover art, so Paper text holds contrast on every palette.
    static let scrim = LinearGradient(
        colors: [ink.opacity(0), ink.opacity(0.6), ink.opacity(0.9)], startPoint: .top, endPoint: .bottom)

    /// The kit's ease-out at the panel duration (220 ms); controls use 120 ms.
    static let motion = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.22)
    static let motionFast = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.12)

    enum Space {
        static let s1: CGFloat = 4
        static let s2: CGFloat = 8
        static let s3: CGFloat = 12
        static let s4: CGFloat = 16
        static let s6: CGFloat = 24
    }

    static let radiusControl: CGFloat = 10 // kit radius-md: buttons and cards
    static let radiusWindow: CGFloat = 10
    static let radiusTag: CGFloat = 4      // kit radius-sm: tags, badges, fields
    static let radiusPoster: CGFloat = 18  // game posters: rounder than controls, so games read as objects

    #if os(macOS)
    static let controlHeight: CGFloat = 24
    static let rowHeight: CGFloat = 28
    /// The kit's `small` (11 pt): `.subheadline` is 11 pt on macOS.
    static let small: Font = .custom("Figtree-Regular", size: 11, relativeTo: .subheadline)
    #else
    /// 44 pt touch targets (the kit's 24 pt is macOS only).
    static let controlHeight: CGFloat = 44
    static let rowHeight: CGFloat = 44
    /// `.subheadline` is 15 pt on iOS, so the kit's `small` maps to `.footnote` (13 pt).
    static let small: Font = .custom("Figtree-Regular", size: 13, relativeTo: .footnote)
    #endif

    /// Figtree carries the interface (a free stand-in for Steam's Motiva Sans): regular through extra bold.
    static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        let name = switch weight {
        case .heavy, .black: "Figtree-ExtraBold"
        case .bold: "Figtree-Bold"
        case .semibold: "Figtree-SemiBold"
        case .medium: "Figtree-Medium"
        default: "Figtree-Regular"
        }
        return .custom(name, size: size, relativeTo: style)
    }

    /// Geist Mono: ids, versions and readings only, never decoration.
    static func mono(_ size: CGFloat, relativeTo style: Font.TextStyle = .footnote) -> Font {
        .custom("GeistMono-Regular", size: size, relativeTo: style)
    }

    /// Figtree Bold for display text at 28 pt and up: greetings, hero and game titles.
    static func display(_ size: CGFloat) -> Font {
        #if os(iOS)
        let size = UIFontMetrics.default.scaledValue(for: size) // ponytail: read once; no live Dynamic Type update
        #endif
        return .custom("Figtree-Bold", fixedSize: size)
    }

    /// Steam-style section label: small, uppercase, tracked, in the secondary ink.
    static func header(_ size: CGFloat = 14) -> Font { sans(size, .semibold, relativeTo: .headline) }
    static let headerTracking: CGFloat = 1.6

    /// Registers the bundled fonts (Figtree, Geist Mono; SIL OFL). Call once at launch.
    static func registerFonts() {
        let urls = (Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [])
            + (Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? [])
        for url in urls { CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil) }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }

    /// Follows the system appearance; Player views never force a colour scheme.
    fileprivate init(light: UInt32, dark: UInt32) {
        #if os(macOS)
        self.init(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let hex = isDark ? dark : light
            return NSColor(
                srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1)
        })
        #else
        self.init(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1)
        })
        #endif
    }
}

/// Default action. Not `.borderedProminent`: its white label is 1.3:1 on dark-mode Tea Green.
struct PearPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(PearTheme.sans(16, .semibold))
            .foregroundStyle(PearTheme.onAccent)
            .padding(.horizontal, PearTheme.Space.s6)
            .frame(minHeight: PearTheme.controlHeight)
            .background(PearTheme.accent, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
            .offset(y: configuration.isPressed ? 1 : 0)
            .opacity(!isEnabled ? 0.45 : (configuration.isPressed ? 0.88 : 1))
            .animation(PearTheme.motionFast, value: configuration.isPressed)
    }
}

struct PearSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(PearTheme.sans(16, .semibold))
            .foregroundStyle(isEnabled ? PearTheme.text : PearTheme.textSecondary)
            .padding(.horizontal, PearTheme.Space.s6)
            .frame(minHeight: PearTheme.controlHeight)
            .background(
                configuration.isPressed ? PearTheme.sandy.opacity(0.14) : Color.clear,
                in: RoundedRectangle(cornerRadius: PearTheme.radiusControl)
            )
            .overlay {
                RoundedRectangle(cornerRadius: PearTheme.radiusControl)
                    .strokeBorder(PearTheme.lineControl.opacity(isEnabled ? 1 : 0.5), lineWidth: 1)
            }
    }
}

/// A filter that reads as selected through a `bgSelected` fill (the system button toggle draws white on the tint).
struct PearFilterToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            configuration.label
                .foregroundStyle(configuration.isOn ? PearTheme.text : PearTheme.textSecondary)
                .padding(.horizontal, PearTheme.Space.s2)
                .frame(minHeight: PearTheme.controlHeight)
                .background(
                    configuration.isOn ? PearTheme.bgSelected : Color.clear,
                    in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
    }
}

/// Game tiles and the featured hero: a short spring press, so tapping a game feels physical.
struct PearPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.6), value: configuration.isPressed)
    }
}
