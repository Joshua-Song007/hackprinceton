<!--
{
  "availability" : [
    "iOS: 17.0.0 -",
    "iPadOS: 17.0.0 -",
    "macCatalyst: 17.0.0 -",
    "macOS: 14.0.0 -",
    "tvOS: 17.0.0 -",
    "visionOS: 1.0.0 -"
  ],
  "documentType" : "symbol",
  "framework" : "Vision",
  "identifier" : "/documentation/Vision/VNDetectHumanBodyPose3DRequest",
  "metadataVersion" : "0.1.0",
  "role" : "Class",
  "symbol" : {
    "kind" : "Class",
    "modules" : [
      "Vision"
    ],
    "preciseIdentifier" : "c:objc(cs)VNDetectHumanBodyPose3DRequest"
  },
  "title" : "VNDetectHumanBodyPose3DRequest"
}
-->

# VNDetectHumanBodyPose3DRequest

A request that detects points on human bodies in 3D space, relative to the camera.

```
class VNDetectHumanBodyPose3DRequest
```

## Overview

This request generates a collection of [`VNHumanBodyPose3DObservation`](/documentation/Vision/VNHumanBodyPose3DObservation) objects that describe the position of each body the request detects. If the system allows it, the request uses <doc://com.apple.documentation/documentation/AVFoundation/AVDepthData> information to improve the accuracy.

## Topics

### Initializing a Request

[`init()`](/documentation/Vision/VNDetectHumanBodyPose3DRequest/init())

Creates a new request with no completion handler.

[`init(completionHandler: VNRequestCompletionHandler?)`](/documentation/Vision/VNDetectHumanBodyPose3DRequest/init(completionHandler:))

Creates a new 3D body pose request with a completion handler.

### Determining Supported Joints

[`var supportedJointsGroupNames: [VNHumanBodyPose3DObservation.JointsGroupName]`](/documentation/Vision/VNDetectHumanBodyPose3DRequest/supportedJointsGroupNames)

Returns the joint names the request supports.

[`var supportedJointNames: [VNHumanBodyPose3DObservation.JointName]`](/documentation/Vision/VNDetectHumanBodyPose3DRequest/supportedJointNames)

Returns the joint group names the request supports.

[`- (NSArray<NSString *> *) supportedJointNamesAndReturnError:(NSError **) error;`](/documentation/Vision/VNDetectHumanBodyPose3DRequest/supportedJointNamesAndReturnError:)

Returns the joint names the request supports.

[`- (NSArray<NSString *> *) supportedJointsGroupNamesAndReturnError:(NSError **) error;`](/documentation/Vision/VNDetectHumanBodyPose3DRequest/supportedJointsGroupNamesAndReturnError:)

Returns the joint group names the request supports.

### Accessing the Results

[`var results: [VNHumanBodyPose3DObservation]?`](/documentation/Vision/VNDetectHumanBodyPose3DRequest/results)

The 3D body pose the request observes.

## Relationships

### Conforms To

[`NSObjectProtocol`](/documentation/ObjectiveC/NSObjectProtocol)

[`Equatable`](/documentation/Swift/Equatable)

[`Hashable`](/documentation/Swift/Hashable)

[`CustomDebugStringConvertible`](/documentation/Swift/CustomDebugStringConvertible)

[`CVarArg`](/documentation/Swift/CVarArg)

[`NSCopying`](/documentation/Foundation/NSCopying)

[`CustomStringConvertible`](/documentation/Swift/CustomStringConvertible)

### Inherits From

[`VNStatefulRequest`](/documentation/Vision/VNStatefulRequest)

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)