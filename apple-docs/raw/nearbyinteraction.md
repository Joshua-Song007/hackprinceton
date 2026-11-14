<!--
{
  "availability" : [
    "Mac Catalyst: 14.0.0 -",
    "iOS: 14.0.0 -",
    "iPadOS: 14.0.0 -",
    "macOS: 11.0.0 -",
    "watchOS: 8.0.0 -"
  ],
  "documentType" : "symbol",
  "framework" : "NearbyInteraction",
  "identifier" : "/documentation/NearbyInteraction",
  "metadataVersion" : "0.1.0",
  "role" : "Framework",
  "symbol" : {
    "kind" : "Framework",
    "modules" : [
      "Nearby Interaction"
    ],
    "preciseIdentifier" : "NearbyInteraction"
  },
  "title" : "Nearby Interaction"
}
-->

# Nearby Interaction

Locate and interact with nearby devices using identifiers, distance, and direction.

## Overview

Use Nearby Interaction in your app to acquire the position of devices with an Ultra Wideband (UWB) chip, such as iPhone 11 or later, Apple Watch, and third-party accessories. To participate in an interaction, devices in physical proximity run an app and share their position and device tokens that uniquely identify them. When the app runs in the foreground, Nearby Interaction notifies the interaction session of the peer’s location by reporting the peer’s direction and distance in meters.

Apple devices use the high-frequency capabilities of the UWB chip to share their positions in the physical environment and enable fluid, interactive sessions. For example:

- A multiuser AR experience that places virtual water balloons in the hands of its participants
- A taxi or rideshare app that employs a peer user’s direction in real time to identify the relative locations of a driver and a customer
- A game app that enables a user to control a paddle with their device and respond to a moving ball on the peer user’s screen, as in the following figure

![An illustration of two hands, each holding an iPhone. Arrows extend from the phones to indicate the users’ physical movement. Onscreen, the app displays a ball and paddle game where the first user’s movement slides the bottom paddle left or right, and the opponent’s movement slides the top paddle left or right. In the center of the screen, a ball with motion lines indicates the movement of the ball as it bounces off the first user’s paddle and heads to the upper-right corner of the screen, which isn’t guarded by the opponent’s paddle. ](images/com.apple.nearbyinteraction/media-3880159@2x.png)

For guidance on designing nearby interactions, see the [Human Interface Guidelines > Nearby interactions](https://developer.apple.com/design/human-interface-guidelines/nearby-interactions).

### Interact with Apple Watch

The UWB chip-capable Apple Watch running watchOS 8 supports Nearby Interaction sessions. Apps share discovery tokens to begin an interaction session in watchOS using a custom server, <doc://com.apple.documentation/documentation/CoreBluetooth>, LAN (TCP/UDP), or <doc://com.apple.documentation/documentation/WatchConnectivity>.

Nearby Interaction in iOS provides a peer device’s distance and direction, whereas Nearby Interaction in watchOS provides only a peer device’s distance.

### Interact with third-party devices

In iOS 15 and later and watchOS 8 and later, UWB-enabled devices can interact with third-party accessories you partner with or develop using the [Nearby Interaction Accessory Protocol Specification](https://developer.apple.com/nearby-interaction/specification). To begin an interaction session with a third-party accessory, establish a data link with the accessory, receive its configuration data, and create an [`NINearbyAccessoryConfiguration`](/documentation/NearbyInteraction/NINearbyAccessoryConfiguration). The framework provides configuration data for your device through [`session(_:didGenerateShareableConfigurationData:for:)`](/documentation/NearbyInteraction/NISessionDelegate/session(_:didGenerateShareableConfigurationData:for:)) that your app sends to the accessory to begin detecting the accessory’s range. For more information on accessory interaction, see [`NINearbyAccessoryConfiguration`](/documentation/NearbyInteraction/NINearbyAccessoryConfiguration).

> Note:
> The ``doc://com.apple.nearbyinteraction/documentation/NearbyInteraction/NIDeviceCapability/supportsPreciseDistanceMeasurement`` function returns <doc://com.apple.documentation/documentation/Swift/false> in Mac apps built with Mac Catalyst. For a compatible iPad or iPhone app running in visionOS, framework features are unavailable, and any calls you make to the framework APIs have no effect.

### Using Nearby Interaction in the background

While your app is in the foreground, it can freely use Nearby Interaction to range with a peer device or third-party accessory. When the app moves to the background, it can continue ranging only if the peer or accessory is Bluetooth Low Energy (LE)-paired and connected.

In iOS 18.4 and later, your app can continue ranging in the background with any supported peer or accessory if the app starts a Live Activity as it goes to the background. For more information about creating Live Activities, see <doc://com.apple.documentation/documentation/ActivityKit>.

In iOS 27.2 and later, DL-TDOA sessions can begin when the system relaunches your app in the background. For example, if your app uses iBeacon region monitoring and DL-TDOA together to locate a device in the physical environment, you can start the DL-TDOA session immediately in the iBeacon region-entry callback. For more information, see [Downlink time difference of arrival ranging](/documentation/NearbyInteraction/dl-tdoa-ranging).

> Note: Enable a capability in Xcode for the  type of background activity your app uses. In your target’s Signing & Capabilities tab, add the Background Modes capability, then select Uses Nearby Interaction.

### Setup

- [Initiating and maintaining a session](/documentation/NearbyInteraction/initiating-and-maintaining-a-session)
- [`NISession`](/documentation/NearbyInteraction/NISession)

### Authorization

- <doc://com.apple.documentation/documentation/BundleResources/Information-Property-List/NSNearbyInteractionUsageDescription>

### Phone interaction

- [Implementing interactions between users in close proximity](/documentation/NearbyInteraction/implementing-interactions-between-users-in-close-proximity)
- [Discovering peers with Multipeer Connectivity](/documentation/NearbyInteraction/discovering-peers-with-multipeer-connectivity)
- [Extending advanced direction finding and ranging](/documentation/NearbyInteraction/extending-advanced-direction-finding-and-ranging)
- [`NINearbyPeerConfiguration`](/documentation/NearbyInteraction/NINearbyPeerConfiguration)

### Watch interaction

- [Implementing proximity-based interactions between a phone and watch](/documentation/NearbyInteraction/implementing-proximity-based-interactions-between-a-phone-and-watch)

### Third-party accessories

- [Implementing spatial interactions with third-party accessories](/documentation/NearbyInteraction/implementing-spatial-interactions-with-third-party-accessories)
- [`NINearbyAccessoryConfiguration`](/documentation/NearbyInteraction/NINearbyAccessoryConfiguration)
- [`NIMotionActivityState`](/documentation/NearbyInteraction/NIMotionActivityState)

### Periodic updates

- [`NINearbyObject`](/documentation/NearbyInteraction/NINearbyObject)
- [`NISessionDelegate`](/documentation/NearbyInteraction/NISessionDelegate)

### Camera assistance

- [Finding devices with precision](/documentation/NearbyInteraction/finding-devices-with-precision)
- [`NIAlgorithmConvergence`](/documentation/NearbyInteraction/NIAlgorithmConvergence)
- [`NIAlgorithmConvergenceStatus`](/documentation/NearbyInteraction/NIAlgorithmConvergenceStatus-2fnve)
- [`NIAlgorithmConvergenceStatus`](/documentation/NearbyInteraction/NIAlgorithmConvergenceStatus-2fbmj)
- [Algorithm Convergence Status](/documentation/NearbyInteraction/algorithm-convergence-status)

### DL-TDOA ranging

- [Downlink time difference of arrival ranging](/documentation/NearbyInteraction/dl-tdoa-ranging)

### Errors

- [`NIError`](/documentation/NearbyInteraction/NIError)
- [`NIError.Code`](/documentation/NearbyInteraction/NIError/Code)
- [`NIErrorDomain`](/documentation/NearbyInteraction/NIErrorDomain)

### Deprecated

Avoid using deprecated configuration in your apps.

- <doc://com.apple.documentation/documentation/BundleResources/Information-Property-List/NSNearbyInteractionAllowOnceUsageDescription>

## Topics

### Articles

[Algorithm Convergence Status](/documentation/NearbyInteraction/algorithm-convergence-status)

The possible Objective-C states of Camera Assistance.

[Discovering peers with Multipeer Connectivity](/documentation/NearbyInteraction/discovering-peers-with-multipeer-connectivity)

Exchange discovery tokens over the local network.

[Downlink time difference of arrival ranging](/documentation/NearbyInteraction/dl-tdoa-ranging)

Use anchor devices to improve the accuracy of indoor positioning.

[Extending advanced direction finding and ranging](/documentation/NearbyInteraction/extending-advanced-direction-finding-and-ranging)

Extend your app’s direction finding capabilities with data from Ultra Wideband devices.

[Finding devices with precision](/documentation/NearbyInteraction/finding-devices-with-precision)

Leverage the spatial awareness of ARKit and Apple Ultra Wideband Chips in your app to guide users to a nearby device.

[Implementing interactions between users in close proximity](/documentation/NearbyInteraction/implementing-interactions-between-users-in-close-proximity)

Enable devices to access relative positioning information.

[Implementing proximity-based interactions between a phone and watch](/documentation/NearbyInteraction/implementing-proximity-based-interactions-between-a-phone-and-watch)

Interact with a nearby Apple Watch by measuring its distance to a paired iPhone.

[Implementing spatial interactions with third-party accessories](/documentation/NearbyInteraction/implementing-spatial-interactions-with-third-party-accessories)

Establish a connection with a nearby accessory to receive periodic measurements of its distance from the user.

[Initiating and maintaining a session](/documentation/NearbyInteraction/initiating-and-maintaining-a-session)

Measure the relative position of a nearby device and coach the user to sustain interaction.

### Classes

[`class NIAlgorithmConvergence`](/documentation/NearbyInteraction/NIAlgorithmConvergence)

An object that provides the state and reason for user coaching recommendations.

[`class NINearbyAccessoryConfiguration`](/documentation/NearbyInteraction/NINearbyAccessoryConfiguration)

A configuration that enables interaction between iPhone and third-party accessories.

[`class NINearbyObject`](/documentation/NearbyInteraction/NINearbyObject)

Location information for a peer device in an interaction session.

[`class NINearbyPeerConfiguration`](/documentation/NearbyInteraction/NINearbyPeerConfiguration)

A configuration that enables interaction between iPhone or Apple Watch devices.

[`class NISession`](/documentation/NearbyInteraction/NISession)

An object that identifies a unique connection between two peer devices.

### Protocols

[`protocol NISessionDelegate`](/documentation/NearbyInteraction/NISessionDelegate)

An object that monitors and reacts to session updates.

### Structures

[`struct NIError`](/documentation/NearbyInteraction/NIError)

An error Nearby Interaction reports.

### Variables

[`let NIErrorDomain: String`](/documentation/NearbyInteraction/NIErrorDomain)

A unique error domain for Nearby Interaction.

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)