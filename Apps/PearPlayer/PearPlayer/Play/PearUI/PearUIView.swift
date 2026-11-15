#if os(iOS)
import CoreLocation
import CoreMotion
import MapKit
import Observation
import PearCloud
import SwiftUI
import UIKit

/// A game version with a `ui.json`: the `/play/{gameId}` socket (with reconnect) feeding a PearUI view state.
/// Script→client events land in `ev.<name>`, `_welcome` in `me`; actions and sensors go out as `{name,data}`.
@MainActor
@Observable
final class PearUISession: Identifiable {
    let title: String
    let doc: PearUIDoc
    let assets: [String: Data]
    private(set) var ev: [String: JSONValue] = [:]
    private(set) var me: JSONValue = .object([:])
    var local: [String: JSONValue] = [:]
    private(set) var connected = false
    let kind = UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "phone"

    private let url: URL
    private var task: URLSessionWebSocketTask?
    private var runner: Task<Void, Never>?
    private var stopped = false
    private let motion = CMMotionManager()
    private var location: LocationFeed?

    init?(base: URL, gameId: String, token: String, version: Int, lobby: String?, title: String, doc: PearUIDoc, bundle: GameBundle) {
        guard let url = QDWire.socketURL(base: base, gameId: gameId, token: token, version: version, lobby: lobby) else { return nil }
        self.url = url
        self.title = title
        self.doc = doc
        self.assets = Dictionary(bundle.assets.map { ($0.name, $0.data) }, uniquingKeysWith: { _, last in last })
        #if DEBUG
        PearUIExpr.selfCheck()
        #endif
    }

    var state: JSONValue {
        .object(["ev": .object(ev), "me": me, "local": .object(local), "device": .object(["kind": .string(kind)])])
    }

    func start() {
        guard runner == nil else { return }
        UIApplication.shared.isIdleTimerDisabled = true
        runner = Task { [weak self] in await self?.run() }
    }

    func stop() {
        stopped = true
        runner?.cancel()
        runner = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        motion.stopDeviceMotionUpdates()
        location = nil
        UIApplication.shared.isIdleTimerDisabled = false
    }

    private func run() async {
        var delay = 0.5
        while !stopped && !Task.isCancelled {
            let socket = URLSession.shared.webSocketTask(with: url)
            task = socket
            socket.resume()
            do {
                while true {
                    if case .string(let text) = try await socket.receive() { delay = 0.5; handle(text) }
                }
            } catch {
                socket.cancel(with: .goingAway, reason: nil)
            }
            if stopped || Task.isCancelled { return }
            connected = false
            try? await Task.sleep(for: .seconds(delay))
            delay = min(delay * 2, 8)
        }
    }

    private func handle(_ text: String) {
        guard let obj = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let name = obj["name"] as? String else { return }
        let data = JSONValue(any: obj["data"])
        switch name {
        case "_welcome":
            me = data
            connected = true
            sendRole()
        case "_reload":
            sendRole()
        default:
            ev[name] = data
        }
    }

    /// Same hello as the native Quick Draw screen: an iPad joins as the referee, a phone as a player.
    // ponytail: not in C1; scripts that ignore `role` are unaffected. Move into ui.json when C1 grows an on-join action.
    private func sendRole() { send("role", .object(["role": .string(kind == "ipad" ? "referee" : "phone"), "kind": .string(kind)])) }

    func send(_ name: String, _ data: JSONValue) {
        guard let task else { return }
        let text = QDWire.frame(name, data.object?.mapValues(\.any) ?? [:])
        Task { try? await task.send(.string(text)) }
    }

    func perform(_ action: JSONValue?, _ state: JSONValue) {
        guard let action else { return }
        if let name = action["send"]?.string {
            send(name, PearUIExpr.resolve(action["data"] ?? .object([:]), state))
        } else if let key = action["set"]?.string {
            local[key] = PearUIExpr.resolve(action["value"] ?? .null, state)
        }
    }

    // MARK: Sensors (one motion stream and one location stream; the last sensor node of a kind wins)

    func startMotion(event: String, hz: Double) {
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 1 / min(max(hz, 1), 30)
        motion.startDeviceMotionUpdates(to: .main) { [weak self] data, _ in
            guard let self, let a = data?.attitude else { return }
            let deg = 180 / Double.pi
            MainActor.assumeIsolated {
                self.send(event, .object(["pitch": .number(a.pitch * deg), "roll": .number(a.roll * deg), "yaw": .number(a.yaw * deg)]))
            }
        }
    }

    func stopMotion() { motion.stopDeviceMotionUpdates() }

    func startLocation(event: String) {
        location = LocationFeed { [weak self] lat, lng, acc in
            self?.send(event, .object(["lat": .number(lat), "lng": .number(lng), "acc": .number(acc)]))
        }
    }

    func stopLocation() { location = nil }
}

private final class LocationFeed: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let onFix: @MainActor @Sendable (Double, Double, Double) -> Void

    init(onFix: @escaping @MainActor @Sendable (Double, Double, Double) -> Void) {
        self.onFix = onFix
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
    }

    deinit { manager.stopUpdatingLocation() }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        let fix = onFix, lat = last.coordinate.latitude, lng = last.coordinate.longitude, acc = last.horizontalAccuracy
        MainActor.assumeIsolated { fix(lat, lng, acc) }
    }
}

/// The game's screen, drawn from `ui.json` (C1) over the live view state.
struct PearUIView: View {
    let session: PearUISession

    var body: some View {
        let state = session.state
        ZStack {
            PearTheme.bgWindow.ignoresSafeArea()
            if let screen = session.doc.screen(state) {
                PearUINode(node: screen, state: state, session: session)
                    .padding(PearTheme.Space.s4)
                    .padding(.top, 44) // below the shared game menu (GameChrome)
            }
        }
        .foregroundStyle(PearTheme.text)
        .task { session.start() }
    }
}

/// One node. Unknown `type` (or a false `if`) renders nothing.
struct PearUINode: View {
    let node: JSONValue
    let state: JSONValue
    let session: PearUISession

    private var type: String { node["type"]?.string ?? "" }
    private var style: JSONValue { node["style"] ?? .object([:]) }
    private func str(_ key: String) -> String { node[key].map { PearUIExpr.resolve($0, state).text } ?? "" }
    private func value(_ key: String) -> JSONValue { node[key].map { v in
        // Expr-typed props (`items`, `markers`, `until`, `on`, gauge `value`) may be bare or in `{{ }}`.
        if case .string(let s) = v { return PearUIExpr.eval(s, state) }
        return v
    } ?? .null }

    var body: some View {
        if let cond = node["if"]?.string, !PearUIExpr.truthy(PearUIExpr.eval(cond, state)) {
            EmptyView()
        } else {
            styled(content)
        }
    }

    private var children: [JSONValue] { node["children"]?.array ?? [] }

    @ViewBuilder private var content: some View {
        switch type {
        case "column":
            VStack(alignment: hAlign, spacing: PearTheme.Space.s3) { kids(children) }
        case "row":
            HStack(spacing: PearTheme.Space.s3) { kids(children) }
        case "stack":
            ZStack(alignment: Alignment(horizontal: hAlign, vertical: .center)) { kids(children) }
        case "text":
            Text(str("value")).font(font).foregroundStyle(tone ?? PearTheme.text).multilineTextAlignment(textAlign)
        case "button":
            Button(str("label")) { session.perform(node["action"], state) }
                .buttonStyle(PearPrimaryButtonStyle())
        case "image":
            if let data = session.assets[str("src")], let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFit()
            }
        case "timer":
            if let until = value("until").number {
                TimelineView(.periodic(from: .now, by: 0.1)) { ctx in
                    let left = max(0, until / 1000 - ctx.date.timeIntervalSince1970)
                    Text(left >= 10 ? String(Int(left.rounded(.up))) : String(format: "%.1f", left))
                        .font(font).monospacedDigit().foregroundStyle(tone ?? PearTheme.text)
                }
            }
        case "list":
            let items = value("items").array ?? []
            VStack(alignment: hAlign, spacing: PearTheme.Space.s2) {
                ForEach(items.indices, id: \.self) { i in
                    if let item = node["item"] {
                        PearUINode(node: item, state: with(item: items[i]), session: session)
                    }
                }
            }
        case "gauge":
            ProgressView(value: min(max(value("value").number ?? 0, 0), 1)).tint(tone ?? PearTheme.accent)
        case "spacer":
            Spacer(minLength: 0)
        case "map":
            PearUIMap(markers: value("markers").array ?? [], follow: node["follow"]?.string == "me")
                .frame(minHeight: 240)
                .clipShape(RoundedRectangle(cornerRadius: PearTheme.radiusControl))
        case "sensor":
            Color.clear.frame(width: 0, height: 0).onAppear(perform: startSensor).onDisappear(perform: stopSensor)
        case "effect":
            Color.clear.frame(width: 0, height: 0).onChange(of: value("on")) { _, _ in fire() }
        default:
            EmptyView()
        }
    }

    private func kids(_ nodes: [JSONValue]) -> some View {
        ForEach(nodes.indices, id: \.self) { PearUINode(node: nodes[$0], state: state, session: session) }
    }

    private func with(item: JSONValue) -> JSONValue {
        guard case .object(var o) = state else { return state }
        o["item"] = item
        return .object(o)
    }

    private func startSensor() {
        let event = str("event")
        guard !event.isEmpty else { return }
        switch str("kind") {
        case "motion": session.startMotion(event: event, hz: value("hz").number ?? 10)
        case "location": session.startLocation(event: event)
        default: break
        }
    }

    private func stopSensor() {
        switch str("kind") {
        case "motion": session.stopMotion()
        case "location": session.stopLocation()
        default: break
        }
    }

    // ponytail: `sound` is ignored; add AVAudioPlayer over `session.assets` when a game needs it.
    private func fire() {
        switch str("haptic") {
        case "light": UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case "heavy": UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "fail": UINotificationFeedbackGenerator().notificationOccurred(.error)
        default: break
        }
    }

    // MARK: Style tokens

    private func styled(_ view: some View) -> some View {
        let pad = CGFloat(style["pad"]?.number ?? 0) * PearTheme.Space.s2
        let grow = style["grow"] == .bool(true)
        return view
            .padding(pad)
            .frame(maxWidth: grow || style["align"] != nil ? .infinity : nil,
                   maxHeight: grow ? .infinity : nil,
                   alignment: Alignment(horizontal: hAlign, vertical: .center))
    }

    private var hAlign: HorizontalAlignment {
        switch style["align"]?.string {
        case "start": .leading
        case "end": .trailing
        default: .center
        }
    }

    private var textAlign: TextAlignment {
        switch style["align"]?.string {
        case "start": .leading
        case "end": .trailing
        default: .center
        }
    }

    private var tone: Color? {
        switch PearUIExpr.resolve(style["tone"] ?? .null, state).string {
        case "accent": PearTheme.accent
        case "good": PearTheme.ok
        case "bad": PearTheme.error
        case "warn": PearTheme.warn
        case "neutral": PearTheme.textSecondary
        default: nil
        }
    }

    private var font: Font {
        switch style["size"]?.string {
        case "s": PearTheme.sans(13, relativeTo: .caption)
        case "l": PearTheme.sans(24, .semibold, relativeTo: .title2)
        case "xl": PearTheme.sans(36, .bold, relativeTo: .largeTitle)
        case "huge": PearTheme.sans(96, .heavy, relativeTo: .largeTitle)
        default: PearTheme.sans(17, relativeTo: .body)
        }
    }
}

/// `map` node: markers `[{lat,lng,label,tone}]`; `follow: "me"` shows and tracks the user's location.
private struct PearUIMap: View {
    let markers: [JSONValue]
    let follow: Bool
    @State private var camera: MapCameraPosition = .automatic

    var body: some View {
        Map(position: $camera) {
            ForEach(markers.indices, id: \.self) { i in
                let m = markers[i]
                if let lat = m["lat"]?.number, let lng = m["lng"]?.number {
                    Marker(m["label"]?.text ?? "", coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng))
                        .tint(m["tone"]?.string == "bad" ? .red : m["tone"]?.string == "good" ? .green : .orange)
                }
            }
            if follow { UserAnnotation() }
        }
        .onAppear { if follow { camera = .userLocation(fallback: .automatic) } }
    }
}
#endif
