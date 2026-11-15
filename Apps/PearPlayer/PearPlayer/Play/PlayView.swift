import PearCore
import RealityKit
import SwiftUI

/// A running game: the scene, a heads-up display, drag-to-look and the five gestures as buttons.
struct PlayView: View {
    let session: GameSession
    let onLeave: () -> Void
    @State private var lastDrag: CGSize = .zero

    private static let cameraName = "pear-camera"

    var body: some View {
        RealityView { content in
            content.add(session.runner.root)
            let camera = PerspectiveCamera()
            camera.name = Self.cameraName
            let o = session.playerOrigin
            camera.position = [Float(o.x), Float(o.y), Float(o.z)]
            content.add(camera)
        } update: { content in
            guard let camera = content.entities.first(where: { $0.name == Self.cameraName }) else { return }
            let q = TouchInput.orientation(yaw: session.yaw, pitch: session.pitch)
            camera.orientation = simd_quatf(ix: Float(q.x), iy: Float(q.y), iz: Float(q.z), r: Float(q.w))
        }
        .background(Color.black)
        .gesture(
            DragGesture(minimumDistance: 2)
                .onChanged { value in
                    session.look(
                        dx: Double(value.translation.width - lastDrag.width),
                        dy: Double(value.translation.height - lastDrag.height))
                    lastDrag = value.translation
                }
                .onEnded { _ in lastDrag = .zero }
        )
        .overlay(alignment: .topLeading) { hud }
        .overlay(alignment: .bottom) { gestureBar }
        .ignoresSafeArea(edges: .bottom)
        #if os(macOS)
        .frame(minWidth: 720, minHeight: 520)
        #endif
    }

    private var hud: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(session.gameName.isEmpty ? "Game" : session.gameName)
                .font(PearTheme.sans(17, .semibold, relativeTo: .headline))
            Label(connectionText, systemImage: connectionSymbol)
                .font(PearTheme.sans(13, .medium, relativeTo: .caption))
                .foregroundStyle(session.connectionLost ? PearTheme.error : PearTheme.text)
            if session.reloaded {
                Text("A new version was published. Leave and play again to get it.")
                    .font(PearTheme.sans(12, relativeTo: .caption))
            }
            ForEach(Array(session.scriptErrors.enumerated()), id: \.offset) { _, error in
                Text(error).font(PearTheme.sans(11, relativeTo: .caption2)).foregroundStyle(PearTheme.warn).lineLimit(2)
            }
        }
        .foregroundStyle(PearTheme.text)
        .padding(PearTheme.Space.s3)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
        .padding()
        .padding(.top, 44) // below the shared game menu (GameChrome)
        .accessibilityElement(children: .combine)
    }

    private var connectionText: String {
        if session.connectionLost { return "Connection lost" }
        return session.isConnected ? "Connected" : "Connecting…"
    }

    private var connectionSymbol: String {
        if session.connectionLost { return "wifi.slash" }
        return session.isConnected ? "dot.radiowaves.left.and.right" : "ellipsis"
    }

    private var gestureBar: some View {
        HStack(spacing: PearTheme.Space.s2) {
            ForEach(GestureType.allCases, id: \.self) { type in
                Button(Self.label(type)) { session.gesture(type) }
                    .buttonStyle(PearSecondaryButtonStyle())
            }
        }
        .padding(PearTheme.Space.s3)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
        .padding(.bottom, PearTheme.Space.s6)
    }

    private static func label(_ type: GestureType) -> String {
        switch type {
        case .tap: "Tap"
        case .doubleTap: "Double tap"
        case .flick: "Flick"
        case .squeeze: "Squeeze"
        case .pinch: "Pinch"
        }
    }
}
