import PearCore
import SwiftUI
import UIKit

/// Normalized touch events (began / moved / ended) -> USIS `touch` channel, plus Apple Pencil
/// squeeze / double-tap -> `gesture`.
///
/// Must be placed as the SwiftUI `.background` with the content above it
/// `.allowsHitTesting(false)`: a SwiftUI `.overlay` of a UIKit view received no touches (probe).
struct TouchCapture: UIViewRepresentable {
    /// Called on the main actor with the changed channels and the event time (system uptime, seconds).
    let onChannels: @MainActor (UsisChannels, TimeInterval) -> Void

    func makeUIView(context: Context) -> TouchCaptureView {
        let view = TouchCaptureView()
        view.onChannels = onChannels
        return view
    }

    func updateUIView(_ view: TouchCaptureView, context: Context) {
        view.onChannels = onChannels
    }
}

final class TouchCaptureView: UIView, UIPencilInteractionDelegate {
    var onChannels: (@MainActor (UsisChannels, TimeInterval) -> Void)?

    private var touchIds: [ObjectIdentifier: Int] = [:]
    private var nextTouchId = 0
    private var pencilDown = false
    private var lastSqueeze = -TimeInterval.infinity
    /// Squeeze arrives as began -> ended, often twice ~0.25 s apart per physical squeeze (probe).
    private static let squeezeDebounce: TimeInterval = 0.5

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        backgroundColor = .systemBackground
        let pencil = UIPencilInteraction()
        pencil.delegate = self
        addInteraction(pencil)
    }

    required init?(coder: NSCoder) { nil }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) { report(touches, event) }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) { report(touches, event) }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { report(touches, event) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { report(touches, event) }

    private func phase(of touch: UITouch) -> TouchPhase {
        switch touch.phase {
        case .began: .began
        case .ended, .cancelled: .ended
        default: .moved
        }
    }

    private func report(_ touches: Set<UITouch>, _ event: UIEvent?) {
        // The Pencil's continuous channel is unresolved (plan.md `UsisChannels.swift` FLAGGED); only
        // track whether it is down so a resting hand is not reported as finger touches.
        for touch in touches where touch.type == .pencil {
            pencilDown = phase(of: touch) != .ended
        }
        let width = max(bounds.width, 1), height = max(bounds.height, 1)
        var points: [TouchPoint] = []
        for touch in touches where touch.type != .pencil {
            let id = touchId(for: touch)
            let phase = phase(of: touch)
            defer { if phase == .ended { touchIds[ObjectIdentifier(touch)] = nil } }
            if pencilDown && phase != .ended { continue }
            for sample in event?.coalescedTouches(for: touch) ?? [touch] {
                let p = sample.location(in: self)
                points.append(TouchPoint(
                    id: id,
                    x: min(max(Double(p.x / width), 0), 1),
                    y: min(max(Double(p.y / height), 0), 1),
                    phase: phase
                ))
            }
        }
        guard !points.isEmpty else { return }
        let t = event?.timestamp ?? ProcessInfo.processInfo.systemUptime
        onChannels?(UsisChannels(touch: points), t)
    }

    private func touchId(for touch: UITouch) -> Int {
        let key = ObjectIdentifier(touch)
        if let id = touchIds[key] { return id }
        let id = nextTouchId
        nextTouchId += 1
        touchIds[key] = id
        return id
    }

    private func emit(_ gesture: GestureType) {
        onChannels?(UsisChannels(gesture: GestureEvent(type: gesture)), ProcessInfo.processInfo.systemUptime)
    }

    // Both need Squeeze / Double-Tap turned on in Settings -> Apple Pencil (a demo-setup item).
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        emit(.doubleTap)
    }

    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        guard squeeze.phase == .ended else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastSqueeze > Self.squeezeDebounce else { return }
        lastSqueeze = now
        emit(.squeeze)
    }
}
