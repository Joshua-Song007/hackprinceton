<!--
{
  "availability" : [

  ],
  "documentType" : "symbol",
  "framework" : "CoreMotion",
  "identifier" : "/documentation/CoreMotion",
  "metadataVersion" : "0.1.0",
  "role" : "Framework",
  "symbol" : {
    "kind" : "Framework",
    "modules" : [
      "Core Motion"
    ],
    "preciseIdentifier" : "CoreMotion"
  },
  "title" : "Core Motion"
}
-->

# Core Motion

Process accelerometer, gyroscope, pedometer, and environment-related events.

## Overview

Core Motion reports motion- and environment-related data from the available onboard hardware of iOS, iPadOS, watchOS, and visionOS devices. This hardware includes the device’s accelerometers and gyroscopes, and, when available, the pedometer, magnetometer, and barometer. Use this data in your app as input for user interactions, fitness tracking, health-related matters, and more. For example, a game might use accelerometer and gyroscope input to control onscreen game behavior.

The services of this framework provide access to motion data either as raw or processed values, and many services provide both types of values. Raw values reflect the unmodified data from the hardware, while processed values eliminate forms of bias that might adversely affect your usage of the data. For example, a processed accelerometer value reflects only the acceleration caused by the user and not the acceleration caused by gravity.

Not all services are available on all devices, and some services might be unavailable even on devices with the required hardware. For example, many Core Motion services are available to visionOS apps, but those services aren’t available to compatible iPad and iPhone apps running in visionOS. Before you try to use any motion-related services, check the availability of those services using a [`CMMotionManager`](/documentation/CoreMotion/CMMotionManager) object.

> Important:
> An iOS app must include usage description keys in its `Info.plist` file for the types of data it needs. If these keys aren’t present, the app crashes when you try to access the corresponding service. To access motion and fitness data, include <doc://com.apple.documentation/documentation/BundleResources/Information-Property-List/NSMotionUsageDescription>. To access the fall-detection service, include <doc://com.apple.documentation/documentation/BundleResources/Information-Property-List/NSFallDetectionUsageDescription>.

## Topics

### Essentials

  <doc://com.apple.documentation/documentation/Updates/CoreMotion>

[`class CMMotionManager`](/documentation/CoreMotion/CMMotionManager)

The object for starting and managing motion services.

### Device motion

Access acceleration, attitude, rotation, and magnetic field data that is adjusted for gravity and other forms of bias.

[Getting processed device-motion data](/documentation/CoreMotion/getting-processed-device-motion-data)

Retrieve motion data that the system processed to remove environmental bias, such as the effects of gravity.

[`class CMDeviceMotion`](/documentation/CoreMotion/CMDeviceMotion)

Encapsulated measurements of the attitude, rotation rate, and acceleration of a device.

[`class CMAttitude`](/documentation/CoreMotion/CMAttitude)

The device’s orientation relative to a known frame of reference at a point in time.

[`struct CMAttitudeReferenceFrame`](/documentation/CoreMotion/CMAttitudeReferenceFrame)

Constants that indicate the frame of reference for attitude-related motion data.

[`class CMHeadphoneMotionManager`](/documentation/CoreMotion/CMHeadphoneMotionManager)

An object that starts and manages headphone motion services.

[`protocol CMBodyIdentifiable`](/documentation/CoreMotion/CMBodyIdentifiable)

A type that identifies a physical body or view for device-motion calculations.

### Accelerometers

Access accelerometer data for all three axes of the device.

[Getting raw accelerometer events](/documentation/CoreMotion/getting-raw-accelerometer-events)

Retrieve data from the onboard accelerometers.

[`class CMAccelerometerData`](/documentation/CoreMotion/CMAccelerometerData)

A data sample from the device’s three accelerometers.

[`class CMRecordedAccelerometerData`](/documentation/CoreMotion/CMRecordedAccelerometerData)

A single piece of accelerometer data that was recorded by the device.

[`class CMSensorRecorder`](/documentation/CoreMotion/CMSensorRecorder)

An object that gathers and retrieves accelerometer data from a device.

[`class CMSensorDataList`](/documentation/CoreMotion/CMSensorDataList)

A list of the accelerometer data recorded by the system.

### Gyroscopes

Access the raw gyroscope data.

[Getting raw gyroscope events](/documentation/CoreMotion/getting-raw-gyroscope-events)

Retrieve data from the onboard gyroscopes.

[`class CMGyroData`](/documentation/CoreMotion/CMGyroData)

A single measurement of the device’s rotation rate.

### Magnetometer

Access raw magnetometer data.

[`class CMMagnetometerData`](/documentation/CoreMotion/CMMagnetometerData)

Measurements of the Earth’s magnetic field relative to the device.

### Altitude data

Access altitude data based on barometric sensor information.

[`class CMAltimeter`](/documentation/CoreMotion/CMAltimeter)

An object that initiates the delivery of altitude-related changes.

[`class CMAbsoluteAltitudeData`](/documentation/CoreMotion/CMAbsoluteAltitudeData)

Data that records a change in absolute altitude.

[`class CMAltitudeData`](/documentation/CoreMotion/CMAltitudeData)

Data for a recorded change in altitude.

### Ambient pressure

[`class CMRecordedPressureData`](/documentation/CoreMotion/CMRecordedPressureData)

A recorded measurement of pressure data.

[`class CMAmbientPressureData`](/documentation/CoreMotion/CMAmbientPressureData)

A measurement of the ambient pressure and temperature.

### Water submersion

[Accessing submersion data](/documentation/CoreMotion/accessing-submersion-data)

Use a water-submersion manager to receive water pressure, temperature, and depth data on Apple Watch Ultra.

[`class CMWaterSubmersionManager`](/documentation/CoreMotion/CMWaterSubmersionManager)

An object for managing the collection of pressure and temperature data during submersion.

[`protocol CMWaterSubmersionManagerDelegate`](/documentation/CoreMotion/CMWaterSubmersionManagerDelegate)

A delegate that receives updates about ambient pressure, water pressure, water temperature, and submersion events.

[`class CMWaterSubmersionEvent`](/documentation/CoreMotion/CMWaterSubmersionEvent)

An event indicating that the device’s submersion state has changed.

[`class CMWaterSubmersionMeasurement`](/documentation/CoreMotion/CMWaterSubmersionMeasurement)

An update that contains data about the pressure and depth.

[`class CMWaterTemperature`](/documentation/CoreMotion/CMWaterTemperature)

An update that contains data about the water temperature.

### Activity

[`class CMMotionActivityManager`](/documentation/CoreMotion/CMMotionActivityManager)

An object that manages access to the motion data stored by the device.

[`class CMHeadphoneActivityManager`](/documentation/CoreMotion/CMHeadphoneActivityManager)

An object that starts and manages headphone activity services.

[`class CMMotionActivity`](/documentation/CoreMotion/CMMotionActivity)

The data for a single motion update event.

[Getting motion-activity data from headphones](/documentation/CoreMotion/getting-motion-activity-data-from-headphones)

Configure your app to listen for motion-activity changes from headphones.

### Pedometer and fitness

Access step-counting data from the built-in motion processor.

[`class CMPedometer`](/documentation/CoreMotion/CMPedometer)

An object for fetching the system-generated live walking data.

[`class CMPedometerData`](/documentation/CoreMotion/CMPedometerData)

Information about the distance traveled by a user on foot.

[`class CMPedometerEvent`](/documentation/CoreMotion/CMPedometerEvent)

A change in the user’s pedestrian activity.

[`class CMStepCounter`](/documentation/CoreMotion/CMStepCounter)

The number of steps the user has taken with the device.

[`class CMOdometerData`](/documentation/CoreMotion/CMOdometerData)

A class that represents odometer data for workouts.

[`class CMHighFrequencyHeartRateData`](/documentation/CoreMotion/CMHighFrequencyHeartRateData)

A class that represents heart rate data collected at 1 Hz.

### Movement disorder

[Getting movement disorder symptom data](/documentation/CoreMotion/getting-movement-disorder-symptom-data)

Retrieve data from the Apple Watch’s movement disorder manager.

[Adhering to the movement disorder data collection requirements](/documentation/CoreMotion/adhering-to-the-movement-disorder-data-collection-requirements)

Ensure that your users understand and have control over the data your app collects.

[Movement disorder algorithm changelog](/documentation/CoreMotion/movement-disorder-algorithm-changelog)

A chronological log of notable changes to the movement disorder algorithm.

[`class CMMovementDisorderManager`](/documentation/CoreMotion/CMMovementDisorderManager)

A manager for recording and querying movement disorder data.

[`class CMTremorResult`](/documentation/CoreMotion/CMTremorResult)

A result object that contains data about the presence and strength of tremors during a one-minute interval.

[`class CMDyskineticSymptomResult`](/documentation/CoreMotion/CMDyskineticSymptomResult)

A result object that contains data about the likely presence of dyskinetic symptoms during a one-minute interval.

### Fall detection

[`class CMFallDetectionManager`](/documentation/CoreMotion/CMFallDetectionManager)

An object for managing fall detection events.

[`protocol CMFallDetectionDelegate`](/documentation/CoreMotion/CMFallDetectionDelegate)

A delegate that receives information about fall detection events and authorization status changes.

[`class CMFallDetectionEvent`](/documentation/CoreMotion/CMFallDetectionEvent)

An object that contains data about a fall detection event.

  <doc://com.apple.documentation/documentation/BundleResources/Information-Property-List/NSFallDetectionUsageDescription>

### Historical data

Access recorded motion events to help you analyze movement patterns.

[`class CMBatchedSensorManager`](/documentation/CoreMotion/CMBatchedSensorManager)

### Common data

[`class CMLogItem`](/documentation/CoreMotion/CMLogItem)

The base class for all motion-related data objects.

### Classes

[`class CMRecordedDeviceMotion`](/documentation/CoreMotion/CMRecordedDeviceMotion)

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)