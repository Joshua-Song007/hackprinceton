import SwiftUI

/// The one in-app menu every game gets, whatever it draws: a pill at the top-left that asks before leaving and
/// returns to the Pear library. Games never ship their own exit button.
private struct GameChrome: ViewModifier {
    let title: String
    let onLeave: () -> Void
    @State private var confirming = false

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .topLeading) {
                Button { confirming = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left").font(.system(size: 14, weight: .bold))
                        Text("Pear").font(PearTheme.sans(15, .semibold))
                    }
                    .foregroundStyle(PearTheme.text)
                    .padding(.horizontal, 14)
                    .frame(height: 36)
                    .background(PearTheme.bgWindow.opacity(0.8), in: Capsule())
                    .overlay(Capsule().strokeBorder(PearTheme.lineControl))
                }
                .buttonStyle(.plain)
                .padding(PearTheme.Space.s3)
                .accessibilityLabel("Game menu")
                .accessibilityHint("Back to Pear")
            }
            .confirmationDialog(
                title.isEmpty ? "Leave this game?" : "Leave \(title)?", isPresented: $confirming, titleVisibility: .visible
            ) {
                Button("Back to Pear", role: .destructive, action: onLeave)
                Button("Keep playing", role: .cancel) {}
            }
    }
}

extension View {
    func gameChrome(title: String, onLeave: @escaping () -> Void) -> some View {
        modifier(GameChrome(title: title, onLeave: onLeave))
    }
}
