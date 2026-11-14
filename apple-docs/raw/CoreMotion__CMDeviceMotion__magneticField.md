<!--
{
  "availability" : [
    "iOS: 5.0.0 -",
    "iPadOS: 5.0.0 -",
    "macCatalyst: 13.1.0 -",
    "macOS: 10.15.0 -",
    "visionOS: 1.0.0 -",
    "watchOS: 2.0.0 -"
  ],
  "documentType" : "symbol",
  "framework" : "CoreMotion",
  "identifier" : "/documentation/CoreMotion/CMDeviceMotion/magneticField",
  "metadataVersion" : "0.1.0",
  "role" : "Instance Property",
  "symbol" : {
    "kind" : "Instance Property",
    "modules" : [
      "Core Motion"
    ],
    "preciseIdentifier" : "c:objc(cs)CMDeviceMotion(py)magneticField"
  },
  "title" : "magneticField"
}
-->

# magneticField

Returns the magnetic field vector with respect to the device.

```
var magneticField: CMCalibratedMagneticField { get }
```

## Discussion

The [`CMCalibratedMagneticField`](/documentation/CoreMotion/CMCalibratedMagneticField) returned by this property gives you the total magnetic field in the device’s vicinity without device bias. Unlike the [`magneticField`](/documentation/CoreMotion/CMMagnetometerData/magneticField) property of the [`CMMagnetometerData`](/documentation/CoreMotion/CMMagnetometerData) class, these values reflect the earth’s magnetic field plus surrounding fields, minus device bias.

If the device does not have a magnetometer, the `accuracy` field of the property’s value (a [`CMCalibratedMagneticField`](/documentation/CoreMotion/CMCalibratedMagneticField) structure) is [`CMMagneticFieldCalibrationAccuracy.uncalibrated`](/documentation/CoreMotion/CMMagneticFieldCalibrationAccuracy/uncalibrated).

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)