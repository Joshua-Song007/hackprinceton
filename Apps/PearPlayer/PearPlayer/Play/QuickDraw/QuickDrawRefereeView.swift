#if os(iOS)
import SwiftUI

/// The iPad's big-screen Quick Draw: shows the lobby and instructions, then narrates the match. Two iPhones are the guns;
/// this screen holds no slot and sends nothing but its `referee` role. The session plays the sound cues.
struct QuickDrawRefereeView: View {
    let session: QuickDrawSession
    let onLeave: () -> Void

    private var phase: String { session.phase }
    private var phones: [String] { session.state.phones }

    var body: some View {
        ZStack {
            background.ignoresSafeArea()
            VStack(spacing: PearTheme.Space.s6) {
                topBar
                if ["countdown", "arming", "roundOver", "matchOver"].contains(phase) { scoreboard }
                Spacer(minLength: 0)
                content
                Spacer(minLength: 0)
            }
            .padding(PearTheme.Space.s6)
            .frame(maxWidth: 1200)
        }
        .animation(PearTheme.motion, value: phase)
        .task { session.start() }
        .statusBarHidden(phase == "fire")
    }

    private var background: Color {
        switch phase {
        case "fire": Color(red: 0.92, green: 0.1, blue: 0.1)
        case "arming": .black
        default: PearTheme.bgWindow
        }
    }

    private var topBar: some View {
        HStack {
            Color.clear.frame(width: 96, height: 36) // room for the shared game menu (GameChrome)
            Spacer()
            if session.link != .connected {
                Label(session.link == .connecting ? "Connecting" : "Reconnecting", systemImage: "wifi.exclamationmark")
                    .font(PearTheme.small).foregroundStyle(PearTheme.warn)
            } else if phase != "lobby" {
                Text("Lobby \(session.lobby)").font(PearTheme.mono(15)).foregroundStyle(PearTheme.textSecondary)
            }
        }
        .opacity(phase == "arming" || phase == "fire" ? 0.4 : 1)
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case "countdown": countdown
        case "arming": arming
        case "fire": fire
        case "roundOver": roundOver
        case "matchOver": matchOver
        default: lobby
        }
    }

    private func name(_ id: String) -> String { session.playerName(id) }

    // MARK: Lobby

    private var lobby: some View {
        ScrollView {
            VStack(spacing: PearTheme.Space.s6) {
                VStack(spacing: PearTheme.Space.s2) {
                    Text("LOBBY CODE").font(PearTheme.header(18)).tracking(PearTheme.headerTracking).foregroundStyle(PearTheme.textSecondary)
                    Text(session.lobby)
                        .font(PearTheme.mono(150, relativeTo: .largeTitle)).fontWeight(.bold)
                        .foregroundStyle(PearTheme.accent).minimumScaleFactor(0.4).lineLimit(1)
                        .accessibilityLabel("Lobby code \(session.lobby.map(String.init).joined(separator: " "))")
                    Text("On your iPhone: open Pear \u{2192} Quick Draw \u{2192} Join \u{2192} enter \(session.lobby)")
                        .font(PearTheme.sans(24, .medium)).foregroundStyle(PearTheme.text).multilineTextAlignment(.center)
                    ShareLink(item: "Join my Quick Draw lobby in Pear: \(session.lobby)") {
                        Label("Share code", systemImage: "square.and.arrow.up").font(PearTheme.sans(17, .semibold))
                    }
                    .buttonStyle(PearSecondaryButtonStyle())
                }

                if !session.state.needs.isEmpty {
                    Text(session.state.needs.prefix(1).uppercased() + session.state.needs.dropFirst())
                        .font(PearTheme.sans(30, .heavy)).foregroundStyle(PearTheme.text).multilineTextAlignment(.center)
                        .accessibilityIdentifier("qd-needs")
                }

                HStack(spacing: PearTheme.Space.s6) {
                    ForEach(0..<2, id: \.self) { slot in
                        GunSlot(index: slot + 1, player: phones.indices.contains(slot) ? session.state.players.first { $0.id == phones[slot] } : nil)
                    }
                }

                VStack(spacing: PearTheme.Space.s1) {
                    let queued = session.state.queue.map(name)
                    if !queued.isEmpty {
                        Text("Next up: \(queued.joined(separator: ", "))").font(PearTheme.sans(20, .semibold)).foregroundStyle(PearTheme.sandy)
                    }
                    let watching = session.state.watching(excluding: session.myId)
                    if watching > 0 {
                        Text("\(watching) watching").font(PearTheme.sans(17)).foregroundStyle(PearTheme.textSecondary)
                    }
                }

                howToPlay
            }
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private var howToPlay: some View {
        VStack(alignment: .leading, spacing: PearTheme.Space.s3) {
            Text("HOW TO PLAY").font(PearTheme.header()).tracking(PearTheme.headerTracking).foregroundStyle(PearTheme.textSecondary)
            ForEach(Array([
                "Hold your phone down at your side",
                "Tap Ready to calibrate",
                "Wait for DRAW!",
                "Raise and aim: fastest wins, best of 3. Moving early is a foul.",
            ].enumerated()), id: \.offset) { i, line in
                HStack(alignment: .firstTextBaseline, spacing: PearTheme.Space.s3) {
                    Text("\(i + 1)").font(PearTheme.sans(22, .heavy)).foregroundStyle(PearTheme.onAccent)
                        .frame(width: 36, height: 36).background(PearTheme.accent, in: Circle())
                    Text(line).font(PearTheme.sans(22)).foregroundStyle(PearTheme.text)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Step \(i + 1): \(line)")
            }
        }
        .padding(PearTheme.Space.s6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PearTheme.bgPanel, in: RoundedRectangle(cornerRadius: PearTheme.radiusWindow))
    }

    // MARK: Match

    private var scoreboard: some View {
        HStack(spacing: PearTheme.Space.s6) {
            ForEach(phones, id: \.self) { id in
                HStack(spacing: PearTheme.Space.s4) {
                    AvatarView(name: name(id), size: 56, accountId: id)
                    Text(name(id)).font(PearTheme.sans(28, .semibold)).lineLimit(1).minimumScaleFactor(0.6)
                    Spacer(minLength: 0)
                    Text("\(session.state.scores[id] ?? 0)").font(PearTheme.sans(64, .heavy)).monospacedDigit()
                        .foregroundStyle(PearTheme.accent).contentTransition(.numericText())
                }
                .padding(PearTheme.Space.s4)
                .frame(maxWidth: .infinity)
                .background(PearTheme.bgPanel, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(name(id)), score \(session.state.scores[id] ?? 0)")
            }
        }
        .foregroundStyle(PearTheme.text)
        .opacity(phase == "arming" ? 0.5 : 1)
    }

    private var bothNames: String { phones.map(name).joined(separator: " and ") }

    private var countdown: some View {
        VStack(spacing: PearTheme.Space.s4) {
            Text("GET READY").font(PearTheme.header(28)).tracking(PearTheme.headerTracking).foregroundStyle(PearTheme.textSecondary)
            Text(session.countdownValue.map(String.init) ?? "").font(PearTheme.sans(420, .heavy)).monospacedDigit()
                .foregroundStyle(PearTheme.accent).contentTransition(.numericText()).minimumScaleFactor(0.3).lineLimit(1)
                .accessibilityLabel(session.countdownValue.map { "\($0)" } ?? "Get ready")
            Text("Round \(max(1, session.state.matchRound)): phones down at your sides").font(PearTheme.sans(24)).foregroundStyle(PearTheme.textSecondary)
        }
    }

    private var arming: some View {
        VStack(spacing: PearTheme.Space.s4) {
            Text("HOLD STILL\u{2026}").font(PearTheme.sans(120, .heavy)).foregroundStyle(PearTheme.textSecondary).minimumScaleFactor(0.4).lineLimit(1)
            Text(bothNames).font(PearTheme.sans(36, .semibold)).foregroundStyle(PearTheme.textSecondary.opacity(0.8))
            Text("Do not move until you see DRAW").font(PearTheme.sans(22)).foregroundStyle(PearTheme.textSecondary.opacity(0.6))
        }
        .multilineTextAlignment(.center)
        .accessibilityElement(children: .combine)
    }

    private var fire: some View {
        Text("DRAW!").font(PearTheme.sans(300, .heavy)).foregroundStyle(.white).minimumScaleFactor(0.3).lineLimit(1)
            .accessibilityLabel("Draw! Raise your phones now")
    }

    private func headline(_ r: QDRoundResult) -> (String, Color) {
        guard let w = r.winnerId else { return ("Tie. Nobody scores.", PearTheme.textSecondary) }
        if r.reason == "foul" {
            let loser = phones.first { $0 != w }.map(name) ?? "The other player"
            return ("\(loser) moved early! \(name(w)) wins the round", PearTheme.accent)
        }
        return ("\(name(w)) wins the round", PearTheme.accent)
    }

    private func reactionBar(_ id: String, _ r: QDRoundResult, maxMs: Int) -> some View {
        let ms = r.reactionMs[id] ?? nil
        let won = r.winnerId == id
        let tag: String? = r.reason == "tie" ? "TIE" : (r.reason == "foul" && !won ? "FOUL" : nil)
        return HStack(spacing: PearTheme.Space.s4) {
            Text(name(id)).font(PearTheme.sans(26, .semibold)).frame(width: 220, alignment: .leading).lineLimit(1).minimumScaleFactor(0.6)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(PearTheme.bgPanel)
                    if let ms {
                        Capsule().fill(won ? PearTheme.accent : PearTheme.lineControl)
                            .frame(width: max(24, geo.size.width * CGFloat(ms) / CGFloat(max(maxMs, 1))))
                    }
                }
            }
            .frame(height: 36)
            if let tag {
                Text(tag).font(PearTheme.sans(20, .heavy)).foregroundStyle(tag == "FOUL" ? PearTheme.error : PearTheme.sandy).frame(width: 80)
            }
            Text(ms.map { "\($0) ms" } ?? "no time").font(PearTheme.mono(28)).frame(width: 150, alignment: .trailing)
                .foregroundStyle(won ? PearTheme.accent : (ms == nil ? PearTheme.textSecondary : PearTheme.text))
        }
        .foregroundStyle(PearTheme.text)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name(id)), \(ms.map { "\($0) milliseconds" } ?? "no time")\(won ? ", winner" : "")\(tag.map { ", \($0.lowercased())" } ?? "")")
    }

    private var roundOver: some View {
        VStack(spacing: PearTheme.Space.s6) {
            if let r = session.lastResult {
                let head = headline(r)
                Text("ROUND \(r.matchRound)").font(PearTheme.header(20)).tracking(PearTheme.headerTracking).foregroundStyle(PearTheme.textSecondary)
                Text(head.0).font(PearTheme.sans(48, .heavy)).foregroundStyle(head.1).multilineTextAlignment(.center)
                let ids = phones.isEmpty ? r.reactionMs.keys.sorted() : phones
                let maxMs = ids.compactMap { r.reactionMs[$0] ?? nil }.max() ?? 1
                VStack(spacing: PearTheme.Space.s4) { ForEach(ids, id: \.self) { reactionBar($0, r, maxMs: maxMs) } }
                    .padding(PearTheme.Space.s6).background(PearTheme.bgPanel.opacity(0.5), in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
            }
            let raised = session.state.players.filter { phones.contains($0.id) && $0.raised }.map(\.name)
            VStack(spacing: PearTheme.Space.s1) {
                Text("Next round starts when both phones are lowered").font(PearTheme.sans(24, .medium)).foregroundStyle(PearTheme.textSecondary)
                if !raised.isEmpty {
                    Text("Waiting for \(raised.joined(separator: " and ")) to lower").font(PearTheme.sans(24, .semibold)).foregroundStyle(PearTheme.sandy)
                }
            }
            .multilineTextAlignment(.center)
        }
    }

    private var matchOver: some View {
        VStack(spacing: PearTheme.Space.s6) {
            let w = session.matchWinner
            Image(systemName: w == nil ? "flag.checkered" : "trophy.fill").font(.system(size: 120))
                .foregroundStyle(w == nil ? PearTheme.textSecondary : PearTheme.sandy).symbolEffect(.bounce, value: w)
            Text(w.map { "\(name($0)) wins the match!" } ?? "Match over")
                .font(PearTheme.sans(72, .heavy)).foregroundStyle(PearTheme.accent).multilineTextAlignment(.center).minimumScaleFactor(0.4)
            Text(phones.map { "\(session.state.scores[$0] ?? 0)" }.joined(separator: " - "))
                .font(PearTheme.sans(96, .heavy)).monospacedDigit().foregroundStyle(PearTheme.text)
                .accessibilityLabel("Final score " + phones.map { "\(name($0)) \(session.state.scores[$0] ?? 0)" }.joined(separator: ", "))
            Text("Tap Ready on both phones to play again").font(PearTheme.sans(28, .medium)).foregroundStyle(PearTheme.textSecondary)
            HStack(spacing: PearTheme.Space.s6) {
                ForEach(session.state.players.filter { phones.contains($0.id) }) { p in
                    Label("\(p.name): \(p.ready ? "Ready" : "Not ready")", systemImage: p.ready ? "checkmark.circle.fill" : "circle")
                        .font(PearTheme.sans(20, .semibold)).foregroundStyle(p.ready ? PearTheme.ok : PearTheme.textSecondary)
                }
            }
        }
    }
}

/// One gun slot card: who holds it and where they are, or a pulsing "Waiting for a phone...".
private struct GunSlot: View {
    let index: Int
    let player: QDPlayer?
    @State private var pulse = false

    var body: some View {
        VStack(spacing: PearTheme.Space.s3) {
            Text("GUN \(index)").font(PearTheme.header(16)).tracking(PearTheme.headerTracking).foregroundStyle(PearTheme.textSecondary)
            if let player {
                AvatarView(name: player.name, size: 120, accountId: player.id)
                Text(player.name).font(PearTheme.sans(36, .heavy)).foregroundStyle(PearTheme.text).lineLimit(1).minimumScaleFactor(0.5)
                Text(player.ready ? "Ready \u{2713}" : "Not ready")
                    .font(PearTheme.sans(24, .semibold)).foregroundStyle(player.ready ? PearTheme.ok : PearTheme.warn)
                Text(player.ready ? "Connected" : "Connected \u{b7} hold phone down, tap Ready")
                    .font(PearTheme.sans(16)).foregroundStyle(PearTheme.textSecondary).multilineTextAlignment(.center)
                idle(player)
            } else {
                Circle().strokeBorder(PearTheme.lineControl, style: StrokeStyle(lineWidth: 2, dash: [6, 5])).frame(width: 120, height: 120)
                    .overlay { Image(systemName: "iphone.gen3").font(.system(size: 44)).foregroundStyle(PearTheme.lineControl) }
                Text("Waiting for a phone\u{2026}").font(PearTheme.sans(26, .medium)).foregroundStyle(PearTheme.textSecondary)
                    .opacity(pulse ? 1 : 0.4)
                    .onAppear { withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { pulse = true } }
            }
        }
        .padding(PearTheme.Space.s6)
        .frame(maxWidth: .infinity, minHeight: 300)
        .background(PearTheme.bgPanel, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
        .overlay(RoundedRectangle(cornerRadius: PearTheme.radiusControl).strokeBorder(player?.ready == true ? PearTheme.ok : PearTheme.line, lineWidth: 2))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(player.map { "Gun \(index), \($0.name), \($0.ready ? "ready" : "not ready")" } ?? "Gun \(index), waiting for a phone")
    }

    /// The server drops a phone that sits unready too long.
    @ViewBuilder private func idle(_ p: QDPlayer) -> some View {
        if let at = p.idleKickAt, !p.ready {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let left = Int((at - ctx.date.timeIntervalSince1970 * 1000) / 1000)
                if left > 0 {
                    Text("Removed in \(left)s unless Ready")
                        .font(PearTheme.sans(18, .medium)).foregroundStyle(left <= 10 ? PearTheme.error : PearTheme.sandy)
                }
            }
        }
    }
}
#endif
