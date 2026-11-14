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
  "identifier" : "/documentation/CoreMotion/CMDeviceMotion/gravity",
  "metadataVersion" : "0.1.0",
  "role" : "Instance Property",
  "symbol" : {
    "kind" : "Instance Property",
    "modules" : [
      "Core Motion"
    ],
    "preciseIdentifier" : "c:objc(cs)CMDeviceMotion(py)gravity"
  },
  "title" : "gravity"
}
-->

# gravity

The gravity acceleration vector expressed in the device’s reference frame.

```
var gravity: CMAcceleration { get }
```

## Discussion

The total acceleration of the device is equal to gravity plus the acceleration the user imparts to the device ([`userAcceleration`](/documentation/CoreMotion/CMDeviceMotion/userAcceleration)).

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)