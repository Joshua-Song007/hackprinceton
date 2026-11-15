#if os(iOS)
import AVFoundation

/// Every Quick Draw sound, synthesized into PCM buffers at init (no asset files). One engine, one node for the one-shots and
/// one for the looping arming drone. The `.playback` session category plays with the silent switch on; `.mixWithOthers`
/// keeps the player's own music running.
@MainActor
final class QuickDrawSounds {
    private static let rate = 44_100.0
    private let engine = AVAudioEngine()
    private let shots = AVAudioPlayerNode()
    private let droneNode = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!
    private let tickBuf, crackBuf, winBuf, loseBuf, fanfareBuf, droneBuf: AVAudioPCMBuffer
    private var started = false

    init() {
        let r = Self.rate
        func make(_ seconds: Double, _ f: (Double) -> Double) -> AVAudioPCMBuffer {
            let n = AVAudioFrameCount(seconds * r)
            let b = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(standardFormatWithSampleRate: r, channels: 1)!, frameCapacity: n)!
            b.frameLength = n
            let p = b.floatChannelData![0]
            for i in 0..<Int(n) { p[i] = Float(max(-1, min(1, f(Double(i) / r)))) }
            return b
        }
        func sine(_ hz: Double, _ t: Double) -> Double { sin(2 * .pi * hz * t) }
        /// Notes back to back, each a decaying sine; `last` stretches the final note.
        func notes(_ hz: [Double], step: Double, last: Double) -> AVAudioPCMBuffer {
            make(step * Double(hz.count - 1) + last) { t in
                let i = min(hz.count - 1, Int(t / step))
                let local = t - Double(i) * step
                let len = i == hz.count - 1 ? last : step
                return 0.35 * sine(hz[i], t) * exp(-3 * local / len) * min(1, local * 400)
            }
        }
        tickBuf = make(0.07) { t in 0.4 * sine(880, t) * exp(-35 * t) }
        crackBuf = make(0.35) { t in (0.7 * Double.random(in: -1...1) + 0.4 * sine(1000, t)) * exp(-14 * t) }
        winBuf = notes([523.25, 659.25, 783.99], step: 0.11, last: 0.35)
        loseBuf = notes([392, 293.66], step: 0.18, last: 0.4)
        fanfareBuf = notes([523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5], step: 0.14, last: 0.7)
        // 1 s holds whole cycles of 110 Hz and the 5 Hz tremolo, so the loop has no click.
        droneBuf = make(1) { t in 0.3 * sine(110, t) * (0.6 + 0.4 * sine(5, t)) }

        engine.attach(shots)
        engine.attach(droneNode)
        engine.connect(shots, to: engine.mainMixerNode, format: format)
        engine.connect(droneNode, to: engine.mainMixerNode, format: format)
    }

    /// Call from a tap or screen appear; starting the engine before the first sound keeps the first tick on time.
    func prepare() {
        guard !started else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, options: [.mixWithOthers])
        try? session.setActive(true)
        do { try engine.start() } catch { return }
        shots.play()
        started = true
    }

    func stopAll() {
        stopDrone()
        shots.stop()
        shots.play()
    }

    func shutdown() {
        stopAll()
        engine.stop()
        started = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func play(_ b: AVAudioPCMBuffer) {
        prepare()
        guard started else { return }
        shots.scheduleBuffer(b, completionHandler: nil)
    }

    func tick() { play(tickBuf) }
    func fire() { stopDrone(); play(crackBuf) }
    func roundWin() { play(winBuf) }
    func roundLose() { play(loseBuf) }
    func matchWin() { play(fanfareBuf) }

    func startDrone() {
        prepare()
        guard started else { return }
        droneNode.stop()
        droneNode.scheduleBuffer(droneBuf, at: nil, options: .loops, completionHandler: nil)
        droneNode.play()
    }

    func stopDrone() { droneNode.stop() }
}
#endif
