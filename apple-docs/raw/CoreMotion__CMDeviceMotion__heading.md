<!--
{
  "availability" : [
    "iOS: 11.0.0 -",
    "iPadOS: 11.0.0 -",
    "macCatalyst: 13.1.0 -",
    "macOS: 10.15.0 -",
    "watchOS: 4.0.0 -"
  ],
  "documentType" : "symbol",
  "framework" : "CoreMotion",
  "identifier" : "/documentation/CoreMotion/CMDeviceMotion/heading",
  "metadataVersion" : "0.1.0",
  "role" : "Instance Property",
  "symbol" : {
    "kind" : "Instance Property",
    "modules" : [
      "Core Motion"
    ],
    "preciseIdentifier" : "c:objc(cs)CMDeviceMotion(py)heading"
  },
  "title" : "heading"
}
-->

# heading

The heading angle (measured in degrees) relative to the current reference frame.

```
var heading: Double { get }
```

## Discussion

This property contains a value in the range of `0.0` to `360.0` degrees. This value is available only when the frame of reference is [`xMagneticNorthZVertical`](/documentation/CoreMotion/CMAttitudeReferenceFrame/xMagneticNorthZVertical) or [`xTrueNorthZVertical`](/documentation/CoreMotion/CMAttitudeReferenceFrame/xTrueNorthZVertical). If the reference frame is [`xArbitraryZVertical`](/documentation/CoreMotion/CMAttitudeReferenceFrame/xArbitraryZVertical) or [`xArbitraryCorrectedZVertical`](/documentation/CoreMotion/CMAttitudeReferenceFrame/xArbitraryCorrectedZVertical), this property contains a negative number to indicate the heading is invalid.

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)