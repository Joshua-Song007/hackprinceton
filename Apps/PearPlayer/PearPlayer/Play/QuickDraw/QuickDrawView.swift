#if os(iOS)
import SwiftUI

/// The iPad is the referee on a big screen; an iPhone is a gun.
struct QuickDrawView: View {
    let session: QuickDrawSession
    let onLeave: () -> Void

    var body: some View {
        if session.isReferee {
            QuickDrawRefereeView(session: session, onLeave: onLeave)
        } else {
            QuickDrawGunView(session: session, onLeave: onLeave)
        }
    }
}

/// Full-screen Quick Draw: lobby, countdown, hold still, draw, round result, match over. The session owns all logic.
private struct QuickDrawGunView: View {
    let session: QuickDrawSession
    let onLeave: () -> Void

    private var phase: String { session.phase }

    var body: some View {
        ZStack {
            background.ignoresSafeArea()
            VStack(spacing: PearTheme.Space.s4) {
                topBar
                versus
                Spacer(minLength: 0)
                content
                Spacer(minLength: 0)
                Text(instruction).font(PearTheme.sans(20, .semibold)).foregroundStyle(phase == "fire" ? .white : PearTheme.text)
                    .multilineTextAlignment(.center).accessibilityIdentifier("qd-instruction")
                #if targetEnvironment(simulator)
                simControls
                #endif
                if let notice = session.notice {
                    Text(notice).font(PearTheme.sans(17, .medium)).foregroundStyle(PearTheme.warn).multilineTextAlignment(.center)
                }
            }
            .padding(PearTheme.Space.s6)
            .frame(maxWidth: 640)
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
            Button(role: .cancel, action: onLeave) {
                Label("Leave", systemImage: "chevron.left").font(PearTheme.sans(17, .semibold))
            }
            .buttonStyle(PearSecondaryButtonStyle())
            .accessibilityHint("Leaves this Quick Draw match")
            Spacer()
            if session.refereeConnected {
                Label("Referee screen connected", systemImage: "tv").font(PearTheme.small).foregroundStyle(PearTheme.accent)
            }
            if session.link != .connected {
                Label(session.link == .connecting ? "Connecting" : "Reconnecting", systemImage: "wifi.exclamationmark")
                    .font(PearTheme.small).foregroundStyle(PearTheme.warn)
            } else {
                Text("Lobby \(session.lobby)").font(PearTheme.mono(13)).foregroundStyle(PearTheme.textSecondary)
            }
        }
        .opacity(phase == "arming" ? 0.5 : 1)
    }

    /// Your name against the opponent's, with the score, from the moment two phones hold slots.
    @ViewBuilder private var versus: some View {
        if let opp = session.opponentId, session.inQueue == nil, session.me?.role == "phone" {
            let mine = session.state.scores[session.myId] ?? 0, theirs = session.state.scores[opp] ?? 0
            Text("\(session.me?.name ?? "You")  \(mine) - \(theirs)  \(session.playerName(opp))")
                .font(PearTheme.sans(17, .semibold)).foregroundStyle(PearTheme.textSecondary).lineLimit(1).minimumScaleFactor(0.6)
                .opacity(phase == "arming" || phase == "fire" ? 0.5 : 1)
                .accessibilityLabel("You, \(session.me?.name ?? ""), \(mine). \(session.playerName(opp)), \(theirs).")
        }
    }

    /// One line per phase telling this player what to do.
    private var instruction: String {
        if let place = session.inQueue { return "A match is on. You are number \(place) in line." }
        switch phase {
        case "countdown": return "Get ready. Phone down at your side."
        case "arming": return "Hold still..."
        case "fire": return "DRAW!"
        case "roundOver":
            return session.isRaised || session.me?.raised == true ? "Lower your phone for the next round" : "Waiting for the other phone to lower"
        case "matchOver": return "Tap Play again when you are both ready"
        default: return session.me?.ready == true ? "Ready. Waiting for the other player" : "Hold your phone down at your side and tap Ready"
        }
    }

    #if targetEnvironment(simulator)
    /// Simulator only: no motion sensor, so these feed the same raise/lower path as CoreMotion.
    private var simControls: some View {
        HStack {
            Text("Sim:").font(PearTheme.small).foregroundStyle(PearTheme.textSecondary)
            Button("Raise") { session.simRaise() }
            Button("Lower") { session.simLower() }
        }
        .buttonStyle(PearSecondaryButtonStyle())
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Simulator motion: Raise or Lower")
    }
    #endif

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

    // MARK: Lobby

    private var lobby: some View {
        VStack(spacing: PearTheme.Space.s6) {
            VStack(spacing: PearTheme.Space.s2) {
                Text("LOBBY CODE").font(PearTheme.header()).tracking(PearTheme.headerTracking).foregroundStyle(PearTheme.textSecondary)
                Text(session.lobby)
                    .font(PearTheme.mono(56, relativeTo: .largeTitle)).fontWeight(.bold)
                    .foregroundStyle(PearTheme.accent)
                    .minimumScaleFactor(0.5).lineLimit(1)
                    .accessibilityLabel("Lobby code \(session.lobby.map(String.init).joined(separator: " "))")
                ShareLink(item: "Join my Quick Draw lobby in Pear: \(session.lobby)") {
                    Label("Share", systemImage: "square.and.arrow.up").font(PearTheme.sans(17, .semibold))
                }
                .buttonStyle(PearSecondaryButtonStyle())
            }

            VStack(spacing: PearTheme.Space.s2) {
                ForEach(session.state.players.filter { $0.role == "phone" }) { p in playerRow(p) }
                ForEach(0..<max(0, 2 - session.state.players.filter { $0.role == "phone" }.count), id: \.self) { _ in
                    Text("Waiting for a player...").font(PearTheme.sans(17)).foregroundStyle(PearTheme.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading).padding(.horizontal, PearTheme.Space.s4)
                        .overlay(RoundedRectangle(cornerRadius: PearTheme.radiusControl).strokeBorder(PearTheme.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                }
            }

            if let place = session.inQueue {
                Text("A match is on. You are number \(place) in line.")
                    .font(PearTheme.sans(18, .semibold)).foregroundStyle(PearTheme.sandy).multilineTextAlignment(.center)
            } else if !session.state.needs.isEmpty {
                Text(session.state.needs.prefix(1).uppercased() + session.state.needs.dropFirst())
                    .font(PearTheme.sans(17)).foregroundStyle(PearTheme.textSecondary).multilineTextAlignment(.center)
            }

            idleKick

            if session.inQueue == nil { readyButton("Ready") }
        }
    }

    private func playerRow(_ p: QDPlayer) -> some View {
        HStack {
            Image(systemName: p.ready ? "checkmark.circle.fill" : "circle")
                .font(.title2).foregroundStyle(p.ready ? PearTheme.ok : PearTheme.lineControl)
            Text(p.id == session.myId ? "\(p.name) (You)" : p.name).font(PearTheme.sans(20, .semibold)).foregroundStyle(PearTheme.text)
            Spacer()
            Text(p.ready ? "Ready" : "Not ready").font(PearTheme.sans(15)).foregroundStyle(PearTheme.textSecondary)
        }
        .padding(.horizontal, PearTheme.Space.s4).frame(minHeight: 52)
        .background(PearTheme.bgPanel, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(p.id == session.myId ? "You" : p.name), \(p.ready ? "ready" : "not ready")")
    }

    /// The server removes a phone that sits unready too long; show the clock so it is never a surprise.
    @ViewBuilder private var idleKick: some View {
        if let at = session.me?.idleKickAt, session.me?.ready != true {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let left = Int((at - ctx.date.timeIntervalSince1970 * 1000) / 1000)
                if left > 0 {
                    Text("Tap Ready within \(left)s or you will be removed")
                        .font(PearTheme.sans(15, .medium)).foregroundStyle(left <= 10 ? PearTheme.error : PearTheme.textSecondary)
                }
            }
        }
    }

    private func readyButton(_ title: String) -> some View {
        Button { session.readyTapped() } label: {
            Text(session.calibrating ? "Hold still..." : (session.me?.ready == true ? "Waiting for the other player" : title))
                .font(PearTheme.sans(24, .bold)).frame(maxWidth: .infinity, minHeight: 72)
        }
        .buttonStyle(PearPrimaryButtonStyle())
        .disabled(!session.canReady)
        .accessibilityHint("Hold your phone still at your side. This sets the lowered position.")
    }

    // MARK: Match phases

    private var scoreLine: some View {
        HStack(spacing: PearTheme.Space.s6) {
            ForEach(session.state.phones, id: \.self) { id in
                VStack {
                    Text("\(session.state.scores[id] ?? 0)").font(PearTheme.sans(44, .heavy)).monospacedDigit()
                    Text(session.name(of: id)).font(PearTheme.sans(15))
                }
                .accessibilityElement(children: .combine)
            }
        }
        .foregroundStyle(PearTheme.text)
    }

    private var countdown: some View {
        VStack(spacing: PearTheme.Space.s6) {
            Text("GET READY").font(PearTheme.header(18)).tracking(PearTheme.headerTracking).foregroundStyle(PearTheme.textSecondary)
            Text(session.countdownValue.map(String.init) ?? "").font(PearTheme.sans(220, .heavy)).monospacedDigit()
                .foregroundStyle(PearTheme.accent).contentTransition(.numericText())
                .accessibilityLabel(session.countdownValue.map { "\($0)" } ?? "Get ready")
            scoreLine
        }
    }

    private var arming: some View {
        VStack(spacing: PearTheme.Space.s4) {
            Text("HOLD STILL").font(PearTheme.sans(56, .heavy)).foregroundStyle(PearTheme.textSecondary)
                .minimumScaleFactor(0.5).lineLimit(1)
            Text("Do not move until you see DRAW").font(PearTheme.sans(18)).foregroundStyle(PearTheme.textSecondary.opacity(0.7))
        }
        .accessibilityElement(children: .combine)
    }

    private var fire: some View {
        Text("DRAW!").font(PearTheme.sans(140, .heavy)).foregroundStyle(.white).minimumScaleFactor(0.4).lineLimit(1)
            .accessibilityLabel("Draw! Raise your phone now")
    }

    private func reactionRow(_ id: String, _ result: QDRoundResult) -> some View {
        let ms = result.reactionMs[id] ?? nil
        return HStack {
            Text(session.name(of: id)).font(PearTheme.sans(20, .semibold))
            if result.winnerId == id { Image(systemName: "crown.fill").foregroundStyle(PearTheme.sandy).accessibilityLabel("Winner") }
            Spacer()
            Text(ms.map { "\($0) ms" } ?? "no time").font(PearTheme.mono(22)).foregroundStyle(ms == nil ? PearTheme.textSecondary : PearTheme.text)
        }
        .padding(.horizontal, PearTheme.Space.s4).frame(minHeight: 52)
        .background(PearTheme.bgPanel, in: RoundedRectangle(cornerRadius: PearTheme.radiusControl))
        .accessibilityElement(children: .combine)
    }

    private func resultHeadline(_ r: QDRoundResult) -> (String, Color) {
        if r.winnerId == nil { return ("Tie. Nobody scores.", PearTheme.textSecondary) }
        let mine = r.winnerId == session.myId
        if r.reason == "foul" { return (mine ? "You win: the other player moved early" : "Foul: you moved early", mine ? PearTheme.ok : PearTheme.error) }
        return (mine ? "You win the round" : "\(session.name(of: r.winnerId)) wins the round", mine ? PearTheme.ok : PearTheme.error)
    }

    private var roundOver: some View {
        VStack(spacing: PearTheme.Space.s6) {
            if let r = session.lastResult {
                let head = resultHeadline(r)
                Text("ROUND \(r.matchRound)").font(PearTheme.header(16)).tracking(PearTheme.headerTracking).foregroundStyle(PearTheme.textSecondary)
                Text(head.0).font(PearTheme.sans(30, .heavy)).foregroundStyle(head.1).multilineTextAlignment(.center)
                VStack(spacing: PearTheme.Space.s2) {
                    ForEach(session.state.phones.isEmpty ? Array(r.reactionMs.keys.sorted()) : session.state.phones, id: \.self) { reactionRow($0, r) }
                }
            }
            scoreLine
        }
    }

    private var matchOver: some View {
        VStack(spacing: PearTheme.Space.s6) {
            let won = session.matchWinner == session.myId
            Image(systemName: won ? "trophy.fill" : "flag.checkered").font(.system(size: 64)).foregroundStyle(won ? PearTheme.sandy : PearTheme.textSecondary)
            Text(won ? "YOU WON THE MATCH" : (session.matchWinner == nil ? "MATCH OVER" : "\(session.name(of: session.matchWinner)) won the match".uppercased()))
                .font(PearTheme.sans(34, .heavy)).foregroundStyle(won ? PearTheme.accent : PearTheme.text).multilineTextAlignment(.center)
            scoreLine
            readyButton("Play again")
            Button("Leave", action: onLeave).buttonStyle(PearSecondaryButtonStyle())
        }
    }
}
#endif
