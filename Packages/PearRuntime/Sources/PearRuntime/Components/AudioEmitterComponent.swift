import RealityKit

/// A named spatial sound attached to an entity. Data only for now: nothing in the runtime plays it yet.
public struct AudioEmitterComponent: Component {
    public var soundName: String
    /// Decibels relative to unity; 0 is unchanged.
    public var gain: Double
    public var loops: Bool

    public init(soundName: String, gain: Double = 0, loops: Bool = false) {
        self.soundName = soundName
        self.gain = gain
        self.loops = loops
    }
}
