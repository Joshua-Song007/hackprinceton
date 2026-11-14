import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Colours, metrics and styles for OmniPlayer (macOS and iOS). Token names follow `docs/brand-kit`; the colour
/// values are the Player palette (Tea Green C2EFB3, Sandy Clay E5B181, Emerald Depths 285943, Clay Soil 764134,
/// Powder Blue A7BED3 and tints of them), not the Studio kit's greys. Packages never import this.
enum OmniTheme {
    static let bgWindow = Color(light: 0xE4F8DD, dark: 0x0C1B14)
    static let bgPanel = Color(light: 0xF0FBEC, dark: 0x10241B)
    static let bgField = Color(light: 0xFFFFFF, dark: 0x08140E)
    static let bgHover = Color(light: 0xE4F8DD, dark: 0x163125)
    static let bgSelected = Color(light: 0xE0E8F0, dark: 0x3D5252)
    static let line = Color(light: 0xE1E8E5, dark: 0x25392A)
    static let lineControl = Color(light: 0x60756A, dark: 0x7F9487)
    static let text = Color(light: 0x16241C, dark: 0xE6F2E0)
    static let textSecondary = Color(light: 0x4F6256, dark: 0xA3B5A9)
    static let accent = Color(light: 0x285943, dark: 0xC2EFB3)
    static let onAccent = Color(light: 0xC2EFB3, dark: 0x12261A)
    static let ok = Color(light: 0x285943, dark: 0xC2EFB3)
    static let warnSoft = Color(light: 0xF7E8D9, dark: 0x2F3325)
    static let error = Color(light: 0x764134, dark: 0xE8907F)

    enum Space {
        static let s1: CGFloat = 4
        static let s2: CGFloat = 8
        static let s3: CGFloat = 12
        static let s4: CGFloat = 16
        static let s6: CGFloat = 24
    }

    static let radiusControl: CGFloat = 5
    static let radiusWindow: CGFloat = 10

    #if os(macOS)
    static let controlHeight: CGFloat = 24
    static let rowHeight: CGFloat = 28
    /// The kit's `small` (11 pt): `.subheadline` is 11 pt on macOS.
    static let small: Font = .subheadline
    #else
    /// 44 pt touch targets (the kit's 24 pt is macOS only).
    static let controlHeight: CGFloat = 44
    static let rowHeight: CGFloat = 44
    /// `.subheadline` is 15 pt on iOS, so the kit's `small` maps to `.footnote` (13 pt).
    static let small: Font = .footnote
    #endif
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
struct OmniPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .fontWeight(.semibold)
            .foregroundStyle(OmniTheme.onAccent)
            .padding(.horizontal, OmniTheme.Space.s4)
            .frame(minHeight: OmniTheme.controlHeight)
            .background(OmniTheme.accent, in: RoundedRectangle(cornerRadius: OmniTheme.radiusControl))
            .opacity(!isEnabled ? 0.4 : (configuration.isPressed ? 0.85 : 1))
    }
}

struct OmniSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(isEnabled ? OmniTheme.text : OmniTheme.textSecondary)
            .padding(.horizontal, OmniTheme.Space.s4)
            .frame(minHeight: OmniTheme.controlHeight)
            .background(
                configuration.isPressed ? OmniTheme.bgHover : OmniTheme.bgPanel,
                in: RoundedRectangle(cornerRadius: OmniTheme.radiusControl)
            )
            .overlay {
                RoundedRectangle(cornerRadius: OmniTheme.radiusControl)
                    .strokeBorder(OmniTheme.lineControl.opacity(isEnabled ? 1 : 0.5), lineWidth: 1)
            }
    }
}

/// A filter that reads as selected through a `bgSelected` fill (the system button toggle draws white on the tint).
struct OmniFilterToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            configuration.label
                .foregroundStyle(configuration.isOn ? OmniTheme.text : OmniTheme.textSecondary)
                .padding(.horizontal, OmniTheme.Space.s2)
                .frame(minHeight: OmniTheme.controlHeight)
                .background(
                    configuration.isOn ? OmniTheme.bgSelected : Color.clear,
                    in: RoundedRectangle(cornerRadius: OmniTheme.radiusControl))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
    }
}
