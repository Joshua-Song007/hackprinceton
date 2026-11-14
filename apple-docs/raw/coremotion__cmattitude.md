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
  "identifier" : "/documentation/CoreMotion/CMAttitude",
  "metadataVersion" : "0.1.0",
  "role" : "Class",
  "symbol" : {
    "kind" : "Class",
    "modules" : [
      "Core Motion"
    ],
    "preciseIdentifier" : "c:objc(cs)CMAttitude"
  },
  "title" : "CMAttitude"
}
-->

# CMAttitude

The device’s orientation relative to a known frame of reference at a point in time.

```
class CMAttitude
```

## Overview

The `CMAttitude` class offers three different mathematical representations of attitude: a rotation matrix, a quaternion, and Euler angles (roll, pitch, and yaw values). You access `CMAttitude` objects through the attitude property of each [`CMDeviceMotion`](/documentation/CoreMotion/CMDeviceMotion) objects passed to an application. An application starts receiving these device-motion objects as a result of calling the [`startDeviceMotionUpdates(using:to:withHandler:)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(using:to:withHandler:)) method, the [`startDeviceMotionUpdates(to:withHandler:)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(to:withHandler:)) method, the [`startDeviceMotionUpdates(using:)`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates(using:)) method, or the [`startDeviceMotionUpdates()`](/documentation/CoreMotion/CMMotionManager/startDeviceMotionUpdates()) method of the [`CMMotionManager`](/documentation/CoreMotion/CMMotionManager) class.

> Note:
> Core Motion outputs a direction cosine matrix (DCM)—basically a rotation from the last “old” orientation to the new orientation of the device.

## Topics

### Getting a Mathematical Representation of Attitude as Euler Angles

[`var roll: Double`](/documentation/CoreMotion/CMAttitude/roll)

The roll of the device, in radians.

[`var pitch: Double`](/documentation/CoreMotion/CMAttitude/pitch)

The pitch of the device, in radians.

[`var yaw: Double`](/documentation/CoreMotion/CMAttitude/yaw)

The yaw of the device, in radians.

### Getting a Mathematical Representation of Attitude as a Rotation Matrix

[`var rotationMatrix: CMRotationMatrix`](/documentation/CoreMotion/CMAttitude/rotationMatrix)

Returns a rotation matrix representing the device’s attitude.

[`struct CMRotationMatrix`](/documentation/CoreMotion/CMRotationMatrix)

The type of a structure representing a rotation matrix.

### Getting a Mathematical Representation of Attitude as a Quaternion

[`var quaternion: CMQuaternion`](/documentation/CoreMotion/CMAttitude/quaternion)

Returns a quaternion representing the device’s attitude.

[`struct CMQuaternion`](/documentation/CoreMotion/CMQuaternion)

The type for a quaternion representing a measurement of attitude.

### Obtaining the Change in Attitude

[`func multiply(byInverseOf: CMAttitude)`](/documentation/CoreMotion/CMAttitude/multiply(byInverseOf:))

Yields the change in attitude given a specific attitude.

### Initializers

[`init?(coder: NSCoder)`](/documentation/CoreMotion/CMAttitude/init(coder:))

## Relationships

### Conforms To

[`NSCopying`](/documentation/Foundation/NSCopying)

[`NSCoding`](/documentation/Foundation/NSCoding)

[`NSSecureCoding`](/documentation/Foundation/NSSecureCoding)

[`Hashable`](/documentation/Swift/Hashable)

[`CustomStringConvertible`](/documentation/Swift/CustomStringConvertible)

[`NSObjectProtocol`](/documentation/ObjectiveC/NSObjectProtocol)

[`CustomDebugStringConvertible`](/documentation/Swift/CustomDebugStringConvertible)

[`CVarArg`](/documentation/Swift/CVarArg)

[`Equatable`](/documentation/Swift/Equatable)

### Inherits From

[`NSObject-swift.class`](/documentation/ObjectiveC/NSObject-swift.class)

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)