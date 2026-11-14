import SwiftUI

/// The Omni coordinate-gizmo mark (`docs/brand-kit/project/assets/Logos`), drawn in the kit's 64 x 64 box.
/// Axis colours are the kit's per appearance and are never recoloured; do not place it on an accent fill.
struct OmniGizmoMark: View {
    var size: CGFloat = 56
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let dark = scheme == .dark
        let yAxis = Color(hex: dark ? 0x7CC96A : 0x2E7D22)
        let xAxis = Color(hex: dark ? 0xF0716B : 0xC22F2A)
        let zAxis = Color(hex: dark ? 0x6AA7F0 : 0x1F63C4)
        let origin = Color(hex: dark ? 0xE4E5E7 : 0x1D1D1F)
        Canvas { context, canvasSize in
            let scale = canvasSize.width / 64
            let center = CGPoint(x: 32 * scale, y: 36 * scale)
            let style = StrokeStyle(lineWidth: 6 * scale, lineCap: .round)
            for (end, color) in [
                (CGPoint(x: 32 * scale, y: 9 * scale), yAxis),
                (CGPoint(x: 55 * scale, y: 49 * scale), xAxis),
                (CGPoint(x: 9 * scale, y: 49 * scale), zAxis),
            ] {
                var path = Path()
                path.move(to: center)
                path.addLine(to: end)
                context.stroke(path, with: .color(color), style: style)
            }
            let radius = 7 * scale
            let dot = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
            context.fill(Path(ellipseIn: dot), with: .color(origin))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
