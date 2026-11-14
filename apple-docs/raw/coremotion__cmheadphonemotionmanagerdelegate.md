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
  "identifier" : "/documentation/CoreMotion/CMHeadphoneMotionManagerDelegate",
  "metadataVersion" : "0.1.0",
  "role" : "Protocol",
  "symbol" : {
    "kind" : "Protocol",
    "modules" : [
      "Core Motion"
    ],
    "preciseIdentifier" : "c:objc(pl)CMHeadphoneMotionManagerDelegate"
  },
  "title" : "CMHeadphoneMotionManagerDelegate"
}
-->

# CMHeadphoneMotionManagerDelegate

A set of methods that defines an interface for connecting and disconnecting headphones.

```
protocol CMHeadphoneMotionManagerDelegate : NSObjectProtocol
```

## Topics

### Connecting and Disconnecting Headphones

[`func headphoneMotionManagerDidConnect(CMHeadphoneMotionManager)`](/documentation/CoreMotion/CMHeadphoneMotionManagerDelegate/headphoneMotionManagerDidConnect(_:))

Performs a callback to the delegate after you connect headphones.

[`func headphoneMotionManagerDidDisconnect(CMHeadphoneMotionManager)`](/documentation/CoreMotion/CMHeadphoneMotionManagerDelegate/headphoneMotionManagerDidDisconnect(_:))

Performs a callback to the delegate after you disconnect headphones.

[`typealias DeviceMotionHandler`](/documentation/CoreMotion/CMHeadphoneMotionManager/DeviceMotionHandler)

The type of block callback for handling headphone-motion data.

## Relationships

### Inherits From

[`NSObjectProtocol`](/documentation/ObjectiveC/NSObjectProtocol)

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)