<!--
{
  "availability" : [
    "iOS: 14.0.0 -",
    "iPadOS: 14.0.0 -",
    "macCatalyst: 14.0.0 -",
    "macOS: 11.0.0 -",
    "tvOS: 14.0.0 -",
    "visionOS: 1.0.0 -"
  ],
  "documentType" : "symbol",
  "framework" : "Vision",
  "identifier" : "/documentation/Vision/VNDetectHumanBodyPoseRequest",
  "metadataVersion" : "0.1.0",
  "role" : "Class",
  "symbol" : {
    "kind" : "Class",
    "modules" : [
      "Vision"
    ],
    "preciseIdentifier" : "c:objc(cs)VNDetectHumanBodyPoseRequest"
  },
  "title" : "VNDetectHumanBodyPoseRequest"
}
-->

# VNDetectHumanBodyPoseRequest

A request that detects a human body pose.

```
class VNDetectHumanBodyPoseRequest
```

## Overview

The framework provides the detected body pose as a [`VNHumanBodyPoseObservation`](/documentation/Vision/VNHumanBodyPoseObservation).

## Topics

### Determining Supported Joints

[`var supportedJointNames: [VNHumanBodyPoseObservation.JointName]`](/documentation/Vision/VNDetectHumanBodyPoseRequest/supportedJointNames)

Retrieves the supported joint names.

[`class func supportedJointNames(forRevision: Int) throws -> [VNHumanBodyPoseObservation.JointName]`](/documentation/Vision/VNDetectHumanBodyPoseRequest/supportedJointNames(forRevision:))

Retrieves the supported joint names for a revision.

[`var supportedJointsGroupNames: [VNHumanBodyPoseObservation.JointsGroupName]`](/documentation/Vision/VNDetectHumanBodyPoseRequest/supportedJointsGroupNames)

Retrieves the supported joint group names.

[`class func supportedJointsGroupNames(forRevision: Int) throws -> [VNHumanBodyPoseObservation.JointsGroupName]`](/documentation/Vision/VNDetectHumanBodyPoseRequest/supportedJointsGroupNames(forRevision:))

Retrieves the supported joint group names for a revision.

[`- (NSArray<NSString *> *) supportedJointNamesAndReturnError:(NSError **) error;`](/documentation/Vision/VNDetectHumanBodyPoseRequest/supportedJointNamesAndReturnError:)

Retrieves the supported joint names.

[`- (NSArray<NSString *> *) supportedJointsGroupNamesAndReturnError:(NSError **) error;`](/documentation/Vision/VNDetectHumanBodyPoseRequest/supportedJointsGroupNamesAndReturnError:)

Retrieves the supported joint group names.

### Accessing the Results

[`var results: [VNHumanBodyPoseObservation]?`](/documentation/Vision/VNDetectHumanBodyPoseRequest/results)

The observed body poses.

### Identifying Body Pose Revisions

[`var VNDetectHumanBodyPoseRequestRevision1: Int`](/documentation/Vision/VNDetectHumanBodyPoseRequestRevision1)

A constant for specifying revision 1 of the body pose detection request.

## Relationships

### Conforms To

[`CustomStringConvertible`](/documentation/Swift/CustomStringConvertible)

[`CustomDebugStringConvertible`](/documentation/Swift/CustomDebugStringConvertible)

[`Equatable`](/documentation/Swift/Equatable)

[`NSObjectProtocol`](/documentation/ObjectiveC/NSObjectProtocol)

[`Hashable`](/documentation/Swift/Hashable)

[`CVarArg`](/documentation/Swift/CVarArg)

[`NSCopying`](/documentation/Foundation/NSCopying)

### Inherits From

[`VNImageBasedRequest`](/documentation/Vision/VNImageBasedRequest)

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)