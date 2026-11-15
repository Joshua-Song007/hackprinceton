import Foundation
import Testing
@testable import PearInput

/// Symmetric exchange: host clock = device clock + `offset`, replied at host time `hostReply`.
private func exchange(_ sync: inout ClockSync, hostReply: Double, offset: Double, rtt: Double = 20) {
    let tSend = hostReply - offset - rtt / 2
    sync.addSample(tSend: tSend, tHost: hostReply, tRecv: tSend + rtt)
}

@Suite struct ClockSyncTests {
    @Test func symmetricExchangeRecoversTheOffsetExactly() {
        var sync = ClockSync()
        // device clock = host − 5000, one-way delay 10 ms
        sync.addSample(tSend: 1000, tHost: 6010, tRecv: 1020)
        #expect(sync.isSynced)
        #expect(sync.offsetMs == 5000)
        #expect(sync.bestRttMs == 20)
    }

    @Test func asymmetricDelayErrorIsBoundedByHalfRtt() {
        var sync = ClockSync()
        // forward 15 ms, return 5 ms
        sync.addSample(tSend: 1000, tHost: 1000 + 5000 + 15, tRecv: 1020)
        #expect(abs(sync.offsetMs - 5000) <= 10)
        #expect(sync.offsetMs == 5005)
    }

    @Test func lowestRttSampleWins() {
        var noisy = ClockSync()
        noisy.addSample(tSend: 1000, tHost: 6070, tRecv: 1080) // rtt 80, forward 70 / return 10 → offset 5030
        noisy.addSample(tSend: 2000, tHost: 7006, tRecv: 2012) // rtt 12, symmetric → offset 5000
        #expect(noisy.offsetMs == 5000)
        #expect(noisy.bestRttMs == 12)

        var reversed = ClockSync()
        reversed.addSample(tSend: 2000, tHost: 7006, tRecv: 2012)
        reversed.addSample(tSend: 1000, tHost: 6070, tRecv: 1080)
        #expect(reversed.offsetMs == 5000)
    }

    @Test func estimateFollowsClockSkewOnceOldSamplesLeaveTheWindow() {
        var sync = ClockSync()
        // device clock drifts 100 ppm against the host: offset(T) = 5000 + 1e-4 · T
        for step in 0...6 {
            let host = Double(step) * 10_000
            exchange(&sync, hostReply: host, offset: 5000 + 1e-4 * host)
        }
        // 0, 10 s and 20 s fell out of the 30 s window; newest of the equal-rtt survivors wins
        #expect(abs(sync.offsetMs - 5006) < 1e-6)
    }

    @Test func toHostAddsTheOffset() {
        var sync = ClockSync()
        exchange(&sync, hostReply: 6010, offset: 5000)
        #expect(sync.toHost(1000) == 6000)
    }

    @Test func unsyncedClockHasZeroOffset() {
        let sync = ClockSync()
        #expect(!sync.isSynced)
        #expect(sync.offsetMs == 0)
        #expect(sync.toHost(123) == 123)
    }

    @Test func anchorAlignsFirstPacketUntilARealSampleArrives() {
        var sync = ClockSync()
        sync.anchor(deviceMs: 100, hostMs: 700)
        #expect(sync.hasAnchor)
        #expect(!sync.isSynced)
        #expect(sync.offsetMs == 600)
        #expect(sync.toHost(100) == 700)

        exchange(&sync, hostReply: 6010, offset: 5000)
        #expect(sync.isSynced)
        #expect(!sync.hasAnchor)
        #expect(sync.offsetMs == 5000)
    }

    @Test func anchorIsIgnoredOnceSynced() {
        var sync = ClockSync()
        exchange(&sync, hostReply: 6010, offset: 5000)
        sync.anchor(deviceMs: 0, hostMs: 99)
        #expect(!sync.hasAnchor)
        #expect(sync.offsetMs == 5000)
    }

    @Test func needsResyncWhenNewestSampleIsOlderThanFiveSeconds() {
        var sync = ClockSync()
        #expect(sync.needsResync(nowMs: 0))
        exchange(&sync, hostReply: 6010, offset: 5000)
        #expect(!sync.needsResync(nowMs: 6010 + 4999))
        #expect(sync.needsResync(nowMs: 6010 + 5001))
    }

    @Test func impossibleSamplesAreIgnored() {
        var sync = ClockSync()
        sync.addSample(tSend: 100, tHost: 5000, tRecv: 90) // reply before send
        sync.addSample(tSend: 100, tHost: .nan, tRecv: 120)
        #expect(!sync.isSynced)
    }
}
