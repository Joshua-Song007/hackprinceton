<!--
{
  "availability" : [
    "iOS: 4.0.0 -",
    "iPadOS: 4.0.0 -",
    "macCatalyst: 13.1.0 -",
    "visionOS: 1.0.0 -",
    "watchOS: 2.0.0 -"
  ],
  "documentType" : "symbol",
  "framework" : "CoreMotion",
  "identifier" : "/documentation/CoreMotion/CMMotionManager",
  "metadataVersion" : "0.1.0",
  "role" : "Class",
  "symbol" : {
    "kind" : "Class",
    "modules" : [
      "Core Motion"
    ],
    "preciseIdentifier" : "c:objc(cs)CMMotionManager"
  },
  "title" : "CMMotionManager"
}
-->

# CMMotionManager

The object for starting and managing motion services.

```
class CMMotionManager
```

## Overview

Use a [`CMMotionManager`](/documentation/CoreMotion/CMMotionManager) object to start the services that report movement detected by the device’s onboard sensors. Use this object to receive four types of motion data:

- **Accelerometer data**, indicating the instantaneous acceleration of the device in three dimensional space.
- **Gyroscope data**, indicating the instantaneous rotation around the device’s three primary axes.
- **Magnetometer data**, indicating the device’s orientation relative to Earth’s magnetic field.
- **Device-motion data**, indicating key motion-related attributes such as the device’s user-initiated acceleration, its attitude, rotation rates, orientation relative to calibrated magnetic fields, and orientation relative to gravity. Core Motion’s sensor fusion algorithms provide this data.

The processed device-motion data gives the device’s attitude, rotation rate, calibrated magnetic fields, the direction of gravity, and the amount of acceleration the user contributes to the device.

> Important:
> Create only one ``doc://com.apple.coremotion/documentation/CoreMotion/CMMotionManager`` object for your app. Multiple instances of this class can affect the rate at which the system receives data from the accelerometer and gyroscope.

You can receive live sensor data at a specified update interval, or you can let the sensors collect data and store it for retrieval later. With both of these approaches,  call the appropriate stop method ([`stopAccelerometerUpdates()`](/documentation/CoreMotion/CMMotionManager/stopAccelerometerUpdates()), [`stopGyroUpdates()`](/documentation/CoreMotion/CMMotionManager/stopGyroUpdates()), [`stopMagnetometerUpdates()`](/documentation/CoreMotion/CMMotionManager/stopMagnetometerUpdates()), and [`stopDeviceMotionUpdates()`](/documentation/CoreMotion/CMMotionManager/stopDeviceMotionUpdates())) when you no longer need the data.

### Receive regular motion updates

To receive motion data at specific intervals, the app calls a start method that takes an operation queue (instance of <doc://com.apple.documentation/documentation/Foundation/OperationQueue>) and a block handler of a specific type for processing those updates.  The motion data is passed into the block handler. The frequency of updates is determined by the value of an interval property.

- **Accelerometer.** Set the [`accelerometerUpdateInterval`](/documentation/CoreMotion/CMMotionManager/accelerometerUpdateInterval) property to specify an update interval. Call  the [`startAccelerometerUpdates(to:withHandler:)`](/documentation/CoreMotion/CMMotionManager/startAccelerometerUpdates(to:withHandler:)) method, passing in a block of type [`CMAccelerometerHandler`](/documentation/CoreMotion/CMAccelerometerHandler). Accelerometer data is passed into the block as [`CMAccelerometerData`](/documentation/CoreMotion/CMAccelerometerData) objects.
- **Gyroscope.** Set the [`gyroUpdateInterval`](/documentation/CoreMotion/CMMotionManager/gyroUpdateInterval) property to specify an update interval. Call  the [`startGyroUpdates(to:withHandler:)`](/documentation/CoreMotion/CMMotionManager/startGyroUpdates(to:withHandler:)) method, passing in a block of type [`CMGyroHandler`](/documentation/CoreMotion/CMGyroHandler). Rotation-rate data is passed into the block as [`CMGyroData`](/documentation/CoreMotion/CMGyroData) objects.
- **Magnetometer.** Set the [`magnetometerUpdateInterval`](/documentation/CoreMotion/CMMotionManager/magnetometerUpdateInterval) property to specify an update interval. Call the [`startMagnetometerUpdates(to:withHandler:)`](/documentation/CoreMotion/CMMotionManager/startMagnetometerUpdates(to:withHandler:)) method, passing a block of type [`CMMagnetometerHandler`](/documentation/CoreMotion/CMMagnetometerHandler). Magnetic-field data is passed into the block as [`CMMagnetometerData`](/documentation/CoreMotion/CMMagnetometerData) objects.
- **Device motion.** Set the [`deviceMotionUpdateInterval`](/documentation/CoreMotion/CMMotionManager/deviceMotionUpdateInterval) property to specify an update interval. Call the [`startDeviceMotionUpdates(using:)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(using:))or [`startDeviceMotionUpdates(using:to:withHandler:)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(using:to:withHandler:)) or [`startDeviceMotionUpdates(to:withHandler:)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(to:withHandler:)) method, passing in a block of type [`CMDeviceMotionHandler`](/documentation/CoreMotion/CMDeviceMotionHandler). With the former method, you can specify a reference frame to be used for the attitude estimates. Rotation-rate data is passed into the block as [`CMDeviceMotion`](/documentation/CoreMotion/CMDeviceMotion) objects.

### Sample motion data periodically

To sample motion data periodically, start a motion service using a method that takes no parameters and periodically access the properties of the [`CMMotionManager`](/documentation/CoreMotion/CMMotionManager). This approach is the recommended approach for apps such as games. Handling accelerometer data in a block introduces additional overhead, and most game apps are only interested in the latest sample of motion data when they render a frame.

- **Accelerometer.** Call [`startAccelerometerUpdates()`](/documentation/CoreMotion/CMMotionManager/startAccelerometerUpdates()) to begin updates and periodically access [`CMAccelerometerData`](/documentation/CoreMotion/CMAccelerometerData) objects by reading the [`accelerometerData`](/documentation/CoreMotion/CMMotionManager/accelerometerData) property.
- **Gyroscope.** Call [`startGyroUpdates()`](/documentation/CoreMotion/CMMotionManager/startGyroUpdates()) to begin updates and periodically access [`CMGyroData`](/documentation/CoreMotion/CMGyroData) objects by reading the [`gyroData`](/documentation/CoreMotion/CMMotionManager/gyroData) property.
- **Magnetometer.** Call [`startMagnetometerUpdates()`](/documentation/CoreMotion/CMMotionManager/startMagnetometerUpdates()) to begin updates and periodically access [`CMMagnetometerData`](/documentation/CoreMotion/CMMagnetometerData) objects by reading the [`magnetometerData`](/documentation/CoreMotion/CMMotionManager/magnetometerData) property.
- **Device motion.** Call the [`startDeviceMotionUpdates(using:)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(using:)) or [`startDeviceMotionUpdates()`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates()) method to begin updates and periodically access [`CMDeviceMotion`](/documentation/CoreMotion/CMDeviceMotion) objects by reading the [`deviceMotion`](/documentation/CoreMotion/CMMotionManager/deviceMotion) property. The [`startDeviceMotionUpdates(using:)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(using:)) method lets you specify a reference frame for the attitude estimates.

### Determine hardware availability and state

If a hardware feature (for example, a gyroscope) is not available on a device, calling a start method related to that feature has no effect. You can find out whether a hardware feature is available or active by checking the appropriate property; for example, for gyroscope data, you can check the value of the [`isGyroAvailable`](/documentation/CoreMotion/CMMotionManager/isGyroAvailable) or [`isGyroActive`](/documentation/CoreMotion/CMMotionManager/isGyroActive) properties.

### Identify the coordinate axes of the device

To interpret accelerometer, gyroscope, or attitude information, you need to know the orientation of the device’s coordinate axes. The following illustration shows the positive x-axis, positive y-axis, and positive z-axis for motion-capable Apple devices.

![An illustration showing iPhone, iPad, Apple Watch, and Apple Vision Pro with labels representing the positive x-axis, positive y-axis, and positive z-axis on each device.](images/com.apple.coremotion/media-4302073@2x.png)

## Topics

### Determining the Availability of Services

[`var isDeviceMotionAvailable: Bool`](/documentation/CoreMotion/CMMotionManager/isDeviceMotionAvailable)

A Boolean value that indicates whether the device-motion service is available on the device.

[`var isAccelerometerAvailable: Bool`](/documentation/CoreMotion/CMMotionManager/isAccelerometerAvailable)

A Boolean value that indicates whether an accelerometer is available on the device.

[`var isGyroAvailable: Bool`](/documentation/CoreMotion/CMMotionManager/isGyroAvailable)

A Boolean value that indicates whether a gyroscope is available on the device.

[`var isMagnetometerAvailable: Bool`](/documentation/CoreMotion/CMMotionManager/isMagnetometerAvailable)

A Boolean value that indicates whether a magnetometer is available on the device.

### Determining Which Services Are Active

[`var isDeviceMotionActive: Bool`](/documentation/CoreMotion/CMMotionManager/isDeviceMotionActive)

A Boolean value that determines whether the app is receiving updates from the device-motion service.

[`var isAccelerometerActive: Bool`](/documentation/CoreMotion/CMMotionManager/isAccelerometerActive)

A Boolean value that indicates whether accelerometer updates are currently happening.

[`var isGyroActive: Bool`](/documentation/CoreMotion/CMMotionManager/isGyroActive)

A Boolean value that determines whether gyroscope updates are currently happening.

[`var isMagnetometerActive: Bool`](/documentation/CoreMotion/CMMotionManager/isMagnetometerActive)

A Boolean value that determines whether magnetometer updates are currently happening.

### Managing device motion updates

[`var deviceMotionBody: (any CMBodyIdentifiable)?`](/documentation/CoreMotion/CMMotionManager/deviceMotionBody)

A physical body or view that defines the coordinate system for device-motion data.

[`var showsDeviceMovementDisplay: Bool`](/documentation/CoreMotion/CMMotionManager/showsDeviceMovementDisplay)

Controls whether the device-movement display is shown.

[`var deviceMotionUpdateInterval: TimeInterval`](/documentation/CoreMotion/CMMotionManager/deviceMotionUpdateInterval)

The interval, in seconds, for providing device-motion updates to the block handler.

[`func startDeviceMotionUpdates(using: CMAttitudeReferenceFrame, to: OperationQueue, withHandler: CMDeviceMotionHandler)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(using:to:withHandler:))

Starts device-motion updates on an operation queue and using a specified reference frame and block handler.

[`func startDeviceMotionUpdates(to: OperationQueue, withHandler: CMDeviceMotionHandler)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(to:withHandler:))

Starts device-motion updates on an operation queue and using a specified block handler.

[`func startDeviceMotionUpdates(using: CMAttitudeReferenceFrame)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(using:))

Starts device-motion updates using a reference frame but without a block handler.

[`func startDeviceMotionUpdates()`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates())

Starts device-motion updates without a block handler.

[`func stopDeviceMotionUpdates()`](/documentation/CoreMotion/CMMotionManager/stopDeviceMotionUpdates())

Stops device-motion updates.

[`var deviceMotion: CMDeviceMotion?`](/documentation/CoreMotion/CMMotionManager/deviceMotion)

The latest sample of device-motion data.

[`typealias CMDeviceMotionHandler`](/documentation/CoreMotion/CMDeviceMotionHandler)

The type of block callback for handling device-motion data.

### Managing Accelerometer Updates

[`var accelerometerUpdateInterval: TimeInterval`](/documentation/CoreMotion/CMMotionManager/accelerometerUpdateInterval)

The interval, in seconds, for providing accelerometer updates to the block handler.

[`func startAccelerometerUpdates(to: OperationQueue, withHandler: CMAccelerometerHandler)`](/documentation/CoreMotion/CMMotionManager/startAccelerometerUpdates(to:withHandler:))

Starts accelerometer updates on an operation queue and with a specified handler.

[`func startAccelerometerUpdates()`](/documentation/CoreMotion/CMMotionManager/startAccelerometerUpdates())

Starts accelerometer updates without a handler.

[`func stopAccelerometerUpdates()`](/documentation/CoreMotion/CMMotionManager/stopAccelerometerUpdates())

Stops accelerometer updates.

[`var accelerometerData: CMAccelerometerData?`](/documentation/CoreMotion/CMMotionManager/accelerometerData)

The latest sample of accelerometer data.

[`typealias CMAccelerometerHandler`](/documentation/CoreMotion/CMAccelerometerHandler)

The type of block callback for handling accelerometer data.

### Managing Gyroscope Updates

[`var gyroUpdateInterval: TimeInterval`](/documentation/CoreMotion/CMMotionManager/gyroUpdateInterval)

The interval, in seconds, for providing gyroscope updates to the block handler.

[`func startGyroUpdates(to: OperationQueue, withHandler: CMGyroHandler)`](/documentation/CoreMotion/CMMotionManager/startGyroUpdates(to:withHandler:))

Starts gyroscope updates on an operation queue and with a specified handler.

[`func startGyroUpdates()`](/documentation/CoreMotion/CMMotionManager/startGyroUpdates())

Starts gyroscope updates without a handler.

[`func stopGyroUpdates()`](/documentation/CoreMotion/CMMotionManager/stopGyroUpdates())

Stops gyroscope updates.

[`var gyroData: CMGyroData?`](/documentation/CoreMotion/CMMotionManager/gyroData)

The latest sample of gyroscope data.

[`typealias CMGyroHandler`](/documentation/CoreMotion/CMGyroHandler)

The type of block callback for handling gyroscope data.

### Managing Magnetometer Updates

[`var magnetometerUpdateInterval: TimeInterval`](/documentation/CoreMotion/CMMotionManager/magnetometerUpdateInterval)

The interval, in seconds, at which the system delivers magnetometer data to the block handler.

[`func startMagnetometerUpdates(to: OperationQueue, withHandler: CMMagnetometerHandler)`](/documentation/CoreMotion/CMMotionManager/startMagnetometerUpdates(to:withHandler:))

Starts magnetometer updates on an operation queue and with a specified handler.

[`func startMagnetometerUpdates()`](/documentation/CoreMotion/CMMotionManager/startMagnetometerUpdates())

Starts magnetometer updates without a block handler.

[`func stopMagnetometerUpdates()`](/documentation/CoreMotion/CMMotionManager/stopMagnetometerUpdates())

Stops magnetometer updates.

[`var magnetometerData: CMMagnetometerData?`](/documentation/CoreMotion/CMMotionManager/magnetometerData)

The latest sample of magnetometer data.

[`typealias CMMagnetometerHandler`](/documentation/CoreMotion/CMMagnetometerHandler)

The type of block callback for handling magnetometer data.

### Accessing Attitude Reference Frames

[`var attitudeReferenceFrame: CMAttitudeReferenceFrame`](/documentation/CoreMotion/CMMotionManager/attitudeReferenceFrame)

Returns either the reference frame currently being used or the default attitude reference frame.

[`class func availableAttitudeReferenceFrames() -> CMAttitudeReferenceFrame`](/documentation/CoreMotion/CMMotionManager/availableAttitudeReferenceFrames())

Returns a bitmask of the available reference frames for reporting the attitude of the current device.

### Understanding Errors

[`let CMErrorDomain: String`](/documentation/CoreMotion/CMErrorDomain)

The error domain for Core Motion.

[`struct CMError`](/documentation/CoreMotion/CMError)

Defines motion errors.

### Type Properties

[`class var authorizationStatus: CMAuthorizationStatus`](/documentation/CoreMotion/CMMotionManager/authorizationStatus)

## Relationships

### Conforms To

[`CustomStringConvertible`](/documentation/Swift/CustomStringConvertible)

[`NSObjectProtocol`](/documentation/ObjectiveC/NSObjectProtocol)

[`Hashable`](/documentation/Swift/Hashable)

[`Equatable`](/documentation/Swift/Equatable)

[`CVarArg`](/documentation/Swift/CVarArg)

[`CustomDebugStringConvertible`](/documentation/Swift/CustomDebugStringConvertible)

### Inherits From

[`NSObject-swift.class`](/documentation/ObjectiveC/NSObject-swift.class)

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)