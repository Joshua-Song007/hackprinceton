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
  "identifier" : "/documentation/CoreMotion/CMDeviceMotion/rotationRate",
  "metadataVersion" : "0.1.0",
  "role" : "Instance Property",
  "symbol" : {
    "kind" : "Instance Property",
    "modules" : [
      "Core Motion"
    ],
    "preciseIdentifier" : "c:objc(cs)CMDeviceMotion(py)rotationRate"
  },
  "title" : "rotationRate"
}
-->

# rotationRate

The rotation rate of the device.

```
var rotationRate: CMRotationRate { get }
```

## Discussion

A [`CMRotationRate`](/documentation/CoreMotion/CMRotationRate) structure contains data specifying the device’s rate of rotation around three axes. The value of this property contains a measurement of gyroscope data whose bias has been removed by Core Motion algorithms. The identically name property of [`CMGyroData`](/documentation/CoreMotion/CMGyroData), on the other hand, gives the raw data from the gyroscope. The structure type is declared in `CMGyroData.h`.

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)