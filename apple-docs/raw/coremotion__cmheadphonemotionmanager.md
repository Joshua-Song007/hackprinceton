<!--
{
  "availability" : [
    "iOS: 14.0.0 -",
    "iPadOS: 14.0.0 -",
    "macCatalyst: 14.0.0 -",
    "macOS: 14.0.0 -",
    "watchOS: 7.0.0 -"
  ],
  "documentType" : "symbol",
  "framework" : "CoreMotion",
  "identifier" : "/documentation/CoreMotion/CMHeadphoneMotionManager",
  "metadataVersion" : "0.1.0",
  "role" : "Class",
  "symbol" : {
    "kind" : "Class",
    "modules" : [
      "Core Motion"
    ],
    "preciseIdentifier" : "c:objc(cs)CMHeadphoneMotionManager"
  },
  "title" : "CMHeadphoneMotionManager"
}
-->

# CMHeadphoneMotionManager

An object that starts and manages headphone motion services.

```
class CMHeadphoneMotionManager
```

## Overview

This class delivers headphone motion updates to your app. Use an instance of the manager to determine if the device supports motion, and to start and stop updates. Adopt the [`CMHeadphoneMotionManagerDelegate`](/documentation/CoreMotion/CMHeadphoneMotionManagerDelegate) protocol to receive and respond to motion updates. Before using this class, check [`isDeviceMotionAvailable`](/documentation/CoreMotion/CMHeadphoneMotionManager/isDeviceMotionAvailable) to make sure the feature is available.

> Important:
> In iOS and macOS, include the <doc://com.apple.documentation/documentation/BundleResources/Information-Property-List/NSMotionUsageDescription> key in your app’s `Info.plist` file. If this key is absent, the system crashes your app when you start device-motion updates.

### Identify the coordinate axes

To interpret attitude data, you need to know the orientation of the device’s coordinate axes. The following illustration shows the positive x-axis, positive y-axis, and positive z-axis for motion-capable Apple headphones.

![An illustration showing AirPods Max and AirPods Pro with labels representing the positive x-axis, positive y-axis, and positive z-axis on each device.](images/com.apple.coremotion/media-4302074@2x.png)

## Topics

### Checking Availability

[`var isDeviceMotionAvailable: Bool`](/documentation/CoreMotion/CMHeadphoneMotionManager/isDeviceMotionAvailable)

A Boolean value that indicates whether the current device supports the headphone motion manager.

[`var isDeviceMotionActive: Bool`](/documentation/CoreMotion/CMHeadphoneMotionManager/isDeviceMotionActive)

A Boolean value that indicates whether the headphone motion manager is active.

[`var isConnectionStatusActive: Bool`](/documentation/CoreMotion/CMHeadphoneMotionManager/isConnectionStatusActive)

[`class func authorizationStatus() -> CMAuthorizationStatus`](/documentation/CoreMotion/CMHeadphoneMotionManager/authorizationStatus())

Returns the authorization status for monitoring headphone motion.

### Starting and Stopping Updates

[`func startDeviceMotionUpdates()`](/documentation/CoreMotion/CMHeadphoneMotionManager/startDeviceMotionUpdates())

Starts device-motion updates.

[`func startDeviceMotionUpdates(to: OperationQueue, withHandler: CMHeadphoneMotionManager.DeviceMotionHandler)`](/documentation/CoreMotion/CMHeadphoneMotionManager/startDeviceMotionUpdates(to:withHandler:))

Starts device-motion updates with a handler.

[`func startConnectionStatusUpdates()`](/documentation/CoreMotion/CMHeadphoneMotionManager/startConnectionStatusUpdates())

[`func stopDeviceMotionUpdates()`](/documentation/CoreMotion/CMHeadphoneMotionManager/stopDeviceMotionUpdates())

Stops device-motion updates.

[`func stopConnectionStatusUpdates()`](/documentation/CoreMotion/CMHeadphoneMotionManager/stopConnectionStatusUpdates())

### Getting the Delegate

[`var delegate: (any CMHeadphoneMotionManagerDelegate)?`](/documentation/CoreMotion/CMHeadphoneMotionManager/delegate)

The object that receives headphone motion manager events.

[`protocol CMHeadphoneMotionManagerDelegate`](/documentation/CoreMotion/CMHeadphoneMotionManagerDelegate)

A set of methods that defines an interface for connecting and disconnecting headphones.

### Getting Device-Motion Information

[`var deviceMotion: CMDeviceMotion?`](/documentation/CoreMotion/CMHeadphoneMotionManager/deviceMotion)

The latest device-motion data.

## Relationships

### Conforms To

[`CVarArg`](/documentation/Swift/CVarArg)

[`CustomDebugStringConvertible`](/documentation/Swift/CustomDebugStringConvertible)

[`CustomStringConvertible`](/documentation/Swift/CustomStringConvertible)

[`Hashable`](/documentation/Swift/Hashable)

[`NSObjectProtocol`](/documentation/ObjectiveC/NSObjectProtocol)

[`Equatable`](/documentation/Swift/Equatable)

### Inherits From

[`NSObject-swift.class`](/documentation/ObjectiveC/NSObject-swift.class)

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)