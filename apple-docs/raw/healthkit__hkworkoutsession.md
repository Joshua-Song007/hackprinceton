<!--
{
  "availability" : [
    "iOS: 17.0.0 -",
    "iPadOS: 17.0.0 -",
    "macCatalyst: 17.0.0 -",
    "macOS: -",
    "visionOS: 1.0.0 -",
    "watchOS: 2.0.0 -"
  ],
  "documentType" : "symbol",
  "framework" : "HealthKit",
  "identifier" : "/documentation/HealthKit/HKWorkoutSession",
  "metadataVersion" : "0.1.0",
  "role" : "Class",
  "symbol" : {
    "kind" : "Class",
    "modules" : [
      "HealthKit"
    ],
    "preciseIdentifier" : "c:objc(cs)HKWorkoutSession"
  },
  "title" : "HKWorkoutSession"
}
-->

# HKWorkoutSession

A session that tracks a person’s workout.

```
class HKWorkoutSession
```

## Overview

The session fine-tunes Apple Watch’s sensors for the specified activity. All workout sessions generate high-frequency heart rate samples; however, an outdoor cycling activity generates accurate location data, while an indoor cycling activity doesn’t.

Collecting heart rate data on iPhone or iPad requires pairing with an external heart rate sensor because these devices don’t have one. iPhone and iPad can collect various workout metrics, but the system may generate different samples than those specifically requested by an app.

You can modify the default types of data collected during a workout. After someone saves a workout, you can access and display summary statistics or chart metrics over time.

iPhone typically locks during workouts. For privacy reasons, health data usually isn’t accessible while the device is locked. However, the system can prompt someone to provide your app access to workout data even when their device is locked. You can then display Live Activities on the Lock Screen, providing health metrics without requiring the person to unlock their phone.

Siri support extends to the Lock Screen, allowing people to start, pause, resume, or cancel workouts hands-free. You can integrate Siri intents into your apps to enable this functionality.

Apple Watch runs one workout session at a time. If a second workout starts while your workout is running, your [`HKWorkoutSessionDelegate`](/documentation/HealthKit/HKWorkoutSessionDelegate) object receives an [`HKError.Code.errorAnotherWorkoutSessionStarted`](/documentation/HealthKit/HKError/Code/errorAnotherWorkoutSessionStarted) error, and your session ends.

## Topics

### Creating workout sessions

[`init(healthStore: HKHealthStore, configuration: HKWorkoutConfiguration) throws`](/documentation/HealthKit/HKWorkoutSession/init(healthStore:configuration:))

Returns a newly instantiated workout session with an associated workout builder.

### Monitoring the session

[`var delegate: (any HKWorkoutSessionDelegate)?`](/documentation/HealthKit/HKWorkoutSession/delegate)

The workout session’s delegate.

[`protocol HKWorkoutSessionDelegate`](/documentation/HealthKit/HKWorkoutSessionDelegate)

The session delegate protocol that defines an interface for receiving notifications about errors and changes in the workout session’s state.

### Accessing the workout builder

[`func associatedWorkoutBuilder() -> HKLiveWorkoutBuilder`](/documentation/HealthKit/HKWorkoutSession/associatedWorkoutBuilder())

Returns the live workout builder associated with the workout session.

### Managing the workout

[`func prepare()`](/documentation/HealthKit/HKWorkoutSession/prepare())

Prepares the workout session.

[`func startActivity(with: Date?)`](/documentation/HealthKit/HKWorkoutSession/startActivity(with:))

Starts the workout session activity, and sets the start date.

[`func pause()`](/documentation/HealthKit/HKWorkoutSession/pause())

Pauses the workout session.

[`func resume()`](/documentation/HealthKit/HKWorkoutSession/resume())

Resumes the workout session.

[`func stopActivity(with: Date?)`](/documentation/HealthKit/HKWorkoutSession/stopActivity(with:))

Stops the workout session activity, and sets the end date.

[`func end()`](/documentation/HealthKit/HKWorkoutSession/end())

Ends the workout session.

### Working with remote workout sessions

[`func startMirroringToCompanionDevice(completion: (Bool, (any Error)?) -> Void)`](/documentation/HealthKit/HKWorkoutSession/startMirroringToCompanionDevice(completion:))

Starts mirroring the workout session to the companion iOS device.

[`func stopMirroringToCompanionDevice(completion: (Bool, (any Error)?) -> Void)`](/documentation/HealthKit/HKWorkoutSession/stopMirroringToCompanionDevice(completion:))

Stops mirroring the workout session to the companion iOS device.

[`func sendToRemoteWorkoutSession(data: Data, completion: (Bool, (any Error)?) -> Void)`](/documentation/HealthKit/HKWorkoutSession/sendToRemoteWorkoutSession(data:completion:))

Sends the provided data to the remote workout session.

### Accessing session data

[`var endDate: Date?`](/documentation/HealthKit/HKWorkoutSession/endDate)

The ending time and date for this workout session.

[`var startDate: Date?`](/documentation/HealthKit/HKWorkoutSession/startDate)

The starting time and date for this workout session.

[`var state: HKWorkoutSessionState`](/documentation/HealthKit/HKWorkoutSession/state)

The workout session’s current state.

[`var type: HKWorkoutSessionType`](/documentation/HealthKit/HKWorkoutSession/type)

A value that indicates whether the session is a primary session or a mirrored session.

[`var workoutConfiguration: HKWorkoutConfiguration`](/documentation/HealthKit/HKWorkoutSession/workoutConfiguration)

The configuration object that describes this workout.

### Managing workout activities

[`var currentActivity: HKWorkoutActivity`](/documentation/HealthKit/HKWorkoutSession/currentActivity)

The current workout activity.

[`func beginNewActivity(configuration: HKWorkoutConfiguration, date: Date, metadata: [String : Any]?)`](/documentation/HealthKit/HKWorkoutSession/beginNewActivity(configuration:date:metadata:))

Begins a new workout activity in the workout session.

[`func endCurrentActivity(on: Date)`](/documentation/HealthKit/HKWorkoutSession/endCurrentActivity(on:))

Ends the current workout activity.

### Deprecated methods

[`init(activityType: HKWorkoutActivityType, locationType: HKWorkoutSessionLocationType)`](/documentation/HealthKit/HKWorkoutSession/init(activityType:locationType:))

Returns a newly instantiated workout session.

[`init(configuration: HKWorkoutConfiguration) throws`](/documentation/HealthKit/HKWorkoutSession/init(configuration:))

Returns a newly instantiated workout session.

[`var activityType: HKWorkoutActivityType`](/documentation/HealthKit/HKWorkoutSession/activityType)

The workout activity performed during this session.

[`var locationType: HKWorkoutSessionLocationType`](/documentation/HealthKit/HKWorkoutSession/locationType)

A value that indicates whether the workout session occurred indoors or outdoors.

### Initializers

[`init?(coder: NSCoder)`](/documentation/HealthKit/HKWorkoutSession/init(coder:))

## Relationships

### Conforms To

[`CVarArg`](/documentation/Swift/CVarArg)

[`NSSecureCoding`](/documentation/Foundation/NSSecureCoding)

[`Sendable`](/documentation/Swift/Sendable)

[`NSCoding`](/documentation/Foundation/NSCoding)

[`NSObjectProtocol`](/documentation/ObjectiveC/NSObjectProtocol)

[`Equatable`](/documentation/Swift/Equatable)

[`Hashable`](/documentation/Swift/Hashable)

[`CustomDebugStringConvertible`](/documentation/Swift/CustomDebugStringConvertible)

[`SendableMetatype`](/documentation/Swift/SendableMetatype)

[`CustomStringConvertible`](/documentation/Swift/CustomStringConvertible)

### Inherits From

[`NSObject-swift.class`](/documentation/ObjectiveC/NSObject-swift.class)

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)