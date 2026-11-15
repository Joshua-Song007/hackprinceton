import Foundation
import HealthKit

/// HealthKit workout session that keeps the heart-rate sensor sampling at workout rate and reports
/// each new bpm value. The workout is never saved (`discardWorkout()` on stop).
///
/// `@unchecked Sendable`: `session` / `builder` are touched only from the main actor (`start`, `stop`)
/// and from HealthKit delegate callbacks, which only read `builder` and call `onHeartRate`.
final class HeartRateWorkout: NSObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate, @unchecked Sendable {
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private let onHeartRate: @Sendable (Double) -> Void
    private let onState: @Sendable (String) -> Void

    private static let heartRateType = HKQuantityType(.heartRate)
    private static let unit = HKUnit.count().unitDivided(by: .minute())

    init(onHeartRate: @escaping @Sendable (Double) -> Void, onState: @escaping @Sendable (String) -> Void) {
        self.onHeartRate = onHeartRate
        self.onState = onState
    }

    func start() async {
        guard HKHealthStore.isHealthDataAvailable(), session == nil else {
            onState(HKHealthStore.isHealthDataAvailable() ? "running" : "health unavailable")
            return
        }
        do {
            try await store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [Self.heartRateType])
            let config = HKWorkoutConfiguration()
            config.activityType = .other
            config.locationType = .unknown
            let session = try HKWorkoutSession(healthStore: store, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
            session.delegate = self
            builder.delegate = self
            self.session = session
            self.builder = builder
            let date = Date()
            session.startActivity(with: date)
            try await builder.beginCollection(at: date)
            onState("running")
        } catch {
            session = nil
            builder = nil
            onState("workout failed: \(error.localizedDescription)")
        }
    }

    func stop() {
        session?.end()
    }

    // MARK: HKWorkoutSessionDelegate

    func workoutSession(
        _ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState, date: Date
    ) {
        guard toState == .ended, let builder else { return }
        builder.endCollection(withEnd: date) { [weak self] _, _ in
            builder.discardWorkout()
            self?.session = nil
            self?.builder = nil
            self?.onState("stopped")
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        onState("workout failed: \(error.localizedDescription)")
    }

    // MARK: HKLiveWorkoutBuilderDelegate

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard collectedTypes.contains(Self.heartRateType),
              let bpm = workoutBuilder.statistics(for: Self.heartRateType)?.mostRecentQuantity()?.doubleValue(for: Self.unit)
        else { return }
        onHeartRate(bpm)
    }
}
