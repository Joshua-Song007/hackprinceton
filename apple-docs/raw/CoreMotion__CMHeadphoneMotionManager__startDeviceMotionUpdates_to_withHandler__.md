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
  "identifier" : "/documentation/CoreMotion/CMHeadphoneMotionManager/startDeviceMotionUpdates(to:withHandler:)",
  "metadataVersion" : "0.1.0",
  "role" : "Instance Method",
  "symbol" : {
    "kind" : "Instance Method",
    "modules" : [
      "Core Motion"
    ],
    "preciseIdentifier" : "c:objc(cs)CMHeadphoneMotionManager(im)startDeviceMotionUpdatesToQueue:withHandler:"
  },
  "title" : "startDeviceMotionUpdates(to:withHandler:)"
}
-->

# startDeviceMotionUpdates(to:withHandler:)

Starts device-motion updates with a handler.

```
func startDeviceMotionUpdates(to queue: OperationQueue, withHandler handler: @escaping CMHeadphoneMotionManager.DeviceMotionHandler)
```

## Parameters

`queue`

The queue for handling updates.

`handler`

The handler that receives the updates.

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)