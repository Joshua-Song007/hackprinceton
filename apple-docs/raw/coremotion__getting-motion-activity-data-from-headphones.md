<!--
{
  "availability" : [
    "Xcode: 16.1.0 -",
    "iOS: 18.0.0 -"
  ],
  "documentType" : "article",
  "framework" : "CoreMotion",
  "identifier" : "/documentation/CoreMotion/getting-motion-activity-data-from-headphones",
  "metadataVersion" : "0.1.0",
  "role" : "sampleCode",
  "title" : "Getting motion-activity data from headphones"
}
-->

# Getting motion-activity data from headphones

Configure your app to listen for motion-activity changes from headphones.

## Overview

This sample app demonstrates how to use `CMHeadphoneActivityManager` to request updates when the current type of motion changes. When a change occurs, the app receives update information as a [`CMMotionActivity`](doc://com.apple.documentation/documentation/CoreMotion/CMMotionActivity) object, which it uses to show a text description of the motion change.

### Configure the sample code project

Because this sample app uses headphone motion updates, it needs to run on a device, not in Simulator.  To run this sample, you’ll need the following:

- An iOS device with iOS 18 or later
- Headphones that support motion updates, such as AirPods Pro 2 or AirPods 4

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)