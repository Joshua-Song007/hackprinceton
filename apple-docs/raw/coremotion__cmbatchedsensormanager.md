<!--
{
  "availability" : [
    "iOS: 4.0.0 -",
    "iPadOS: 4.0.0 -",
    "macCatalyst: 13.0.0 -",
    "visionOS: 1.0.0 -",
    "watchOS: 10.0.0 -"
  ],
  "documentType" : "symbol",
  "framework" : "CoreMotion",
  "identifier" : "/documentation/CoreMotion/CMBatchedSensorManager",
  "metadataVersion" : "0.1.0",
  "role" : "Class",
  "symbol" : {
    "kind" : "Class",
    "modules" : [
      "Core Motion"
    ],
    "preciseIdentifier" : "c:objc(cs)CMBatchedSensorManager"
  },
  "title" : "CMBatchedSensorManager"
}
-->

# CMBatchedSensorManager

```
class CMBatchedSensorManager
```

## Topics

### Determining authorization and availability

[`class var authorizationStatus: CMAuthorizationStatus`](/documentation/CoreMotion/CMBatchedSensorManager/authorizationStatus)

[`class var isAccelerometerSupported: Bool`](/documentation/CoreMotion/CMBatchedSensorManager/isAccelerometerSupported)

[`class var isDeviceMotionSupported: Bool`](/documentation/CoreMotion/CMBatchedSensorManager/isDeviceMotionSupported)

### Configuring the update frequency

[`var deviceMotionDataFrequency: Int`](/documentation/CoreMotion/CMBatchedSensorManager/deviceMotionDataFrequency)

[`var accelerometerDataFrequency: Int`](/documentation/CoreMotion/CMBatchedSensorManager/accelerometerDataFrequency)

### Collecting device-motion data

[`func startDeviceMotionUpdates()`](/documentation/CoreMotion/CMBatchedSensorManager/startDeviceMotionUpdates())

[`func startDeviceMotionUpdates(handler: ([CMDeviceMotion]?, (any Error)?) -> Void)`](/documentation/CoreMotion/CMBatchedSensorManager/startDeviceMotionUpdates(handler:))

[`func stopDeviceMotionUpdates()`](/documentation/CoreMotion/CMBatchedSensorManager/stopDeviceMotionUpdates())

[`var deviceMotionBatch: [CMDeviceMotion]?`](/documentation/CoreMotion/CMBatchedSensorManager/deviceMotionBatch)

[`func deviceMotionUpdates() -> CMBatchedSensorManager.DeviceMotionUpdates`](/documentation/CoreMotion/CMBatchedSensorManager/deviceMotionUpdates())

[`struct DeviceMotionUpdates`](/documentation/CoreMotion/CMBatchedSensorManager/DeviceMotionUpdates)

[`var isDeviceMotionActive: Bool`](/documentation/CoreMotion/CMBatchedSensorManager/isDeviceMotionActive)

### Collecting accelerometer data

[`func startAccelerometerUpdates()`](/documentation/CoreMotion/CMBatchedSensorManager/startAccelerometerUpdates())

[`func startAccelerometerUpdates(handler: ([CMAccelerometerData]?, (any Error)?) -> Void)`](/documentation/CoreMotion/CMBatchedSensorManager/startAccelerometerUpdates(handler:))

[`func stopAccelerometerUpdates()`](/documentation/CoreMotion/CMBatchedSensorManager/stopAccelerometerUpdates())

[`var accelerometerBatch: [CMAccelerometerData]?`](/documentation/CoreMotion/CMBatchedSensorManager/accelerometerBatch)

[`func accelerometerUpdates() -> CMBatchedSensorManager.AccelerometerUpdates`](/documentation/CoreMotion/CMBatchedSensorManager/accelerometerUpdates())

[`struct AccelerometerUpdates`](/documentation/CoreMotion/CMBatchedSensorManager/AccelerometerUpdates)

[`var isAccelerometerActive: Bool`](/documentation/CoreMotion/CMBatchedSensorManager/isAccelerometerActive)

## Relationships

### Conforms To

[`Equatable`](/documentation/Swift/Equatable)

[`NSObjectProtocol`](/documentation/ObjectiveC/NSObjectProtocol)

[`Hashable`](/documentation/Swift/Hashable)

[`CustomDebugStringConvertible`](/documentation/Swift/CustomDebugStringConvertible)

[`CVarArg`](/documentation/Swift/CVarArg)

[`CustomStringConvertible`](/documentation/Swift/CustomStringConvertible)

### Inherits From

[`NSObject-swift.class`](/documentation/ObjectiveC/NSObject-swift.class)

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)