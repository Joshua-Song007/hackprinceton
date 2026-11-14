<!--
{
  "availability" : [
    "iOS: 4.0.0 -",
    "iPadOS: 4.0.0 -",
    "macCatalyst: 13.1.0 -",
    "macOS: 10.15.0 -",
    "visionOS: 1.0.0 -",
    "watchOS: 2.0.0 -"
  ],
  "documentType" : "symbol",
  "framework" : "CoreMotion",
  "identifier" : "/documentation/CoreMotion/CMDeviceMotion",
  "metadataVersion" : "0.1.0",
  "role" : "Class",
  "symbol" : {
    "kind" : "Class",
    "modules" : [
      "Core Motion"
    ],
    "preciseIdentifier" : "c:objc(cs)CMDeviceMotion"
  },
  "title" : "CMDeviceMotion"
}
-->

# CMDeviceMotion

Encapsulated measurements of the attitude, rotation rate, and acceleration of a device.

```
class CMDeviceMotion
```

## Overview

An application receives or samples `CMDeviceMotion` objects at regular intervals after calling the [`startDeviceMotionUpdates(using:to:withHandler:)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(using:to:withHandler:)) method, the [`startDeviceMotionUpdates(to:withHandler:)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(to:withHandler:)) method, the [`startDeviceMotionUpdates(using:)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(using:)) method, or the [`startDeviceMotionUpdates()`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates()) method of the [`CMMotionManager`](/documentation/CoreMotion/CMMotionManager) class.

The accelerometer measures the sum of two acceleration vectors: gravity and user acceleration. User acceleration is the acceleration that the user imparts to the device. Because Core Motion is able to track a device’s attitude using both the gyroscope and the accelerometer, it can differentiate between gravity and user acceleration. A `CMDeviceMotion` object provides both measurements in the [`gravity`](/documentation/CoreMotion/CMDeviceMotion/gravity) and [`userAcceleration`](/documentation/CoreMotion/CMDeviceMotion/userAcceleration) properties.

## Topics

### Getting Attitude and Rotation Rate

[`var attitude: CMAttitude`](/documentation/CoreMotion/CMDeviceMotion/attitude)

The attitude of the device.

[`var rotationRate: CMRotationRate`](/documentation/CoreMotion/CMDeviceMotion/rotationRate)

The rotation rate of the device.

### Getting Acceleration Data

[`var gravity: CMAcceleration`](/documentation/CoreMotion/CMDeviceMotion/gravity)

The gravity acceleration vector expressed in the device’s reference frame.

[`var userAcceleration: CMAcceleration`](/documentation/CoreMotion/CMDeviceMotion/userAcceleration)

The acceleration that the user is giving to the device.

### Getting the Calibrated Magnetic Field

[`var magneticField: CMCalibratedMagneticField`](/documentation/CoreMotion/CMDeviceMotion/magneticField)

Returns the magnetic field vector with respect to the device.

[`struct CMCalibratedMagneticField`](/documentation/CoreMotion/CMCalibratedMagneticField)

Calibrated magnetic field data and an estimate of the accuracy of the calibration.

[`enum CMMagneticFieldCalibrationAccuracy`](/documentation/CoreMotion/CMMagneticFieldCalibrationAccuracy)

Indicates the calibration accuracy of a magnetic field estimate

### Getting the Heading

[`var heading: Double`](/documentation/CoreMotion/CMDeviceMotion/heading)

The heading angle (measured in degrees) relative to the current reference frame.

### Getting the Sensor Location

[`var sensorLocation: CMDeviceMotion.SensorLocation`](/documentation/CoreMotion/CMDeviceMotion/sensorLocation-swift.property)

The location of the sensors that compute the device-motion data.

[`enum SensorLocation`](/documentation/CoreMotion/CMDeviceMotion/SensorLocation-swift.enum)

Defines the device’s sensor locations.

### Instance Properties

[`var headingAccuracy: Double`](/documentation/CoreMotion/CMDeviceMotion/headingAccuracy)

## Relationships

### Conforms To

[`NSObjectProtocol`](/documentation/ObjectiveC/NSObjectProtocol)

[`NSCopying`](/documentation/Foundation/NSCopying)

[`CustomStringConvertible`](/documentation/Swift/CustomStringConvertible)

[`CVarArg`](/documentation/Swift/CVarArg)

[`NSSecureCoding`](/documentation/Foundation/NSSecureCoding)

[`Equatable`](/documentation/Swift/Equatable)

[`CustomDebugStringConvertible`](/documentation/Swift/CustomDebugStringConvertible)

[`NSCoding`](/documentation/Foundation/NSCoding)

[`Hashable`](/documentation/Swift/Hashable)

### Inherited By

[`CMRecordedDeviceMotion`](/documentation/CoreMotion/CMRecordedDeviceMotion)

### Inherits From

[`CMLogItem`](/documentation/CoreMotion/CMLogItem)

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)