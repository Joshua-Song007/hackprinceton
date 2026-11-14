<!--
{
  "availability" : [
    "iOS: 7.0.0 -",
    "iPadOS: 7.0.0 -",
    "macCatalyst: 13.1.0 -",
    "macOS: 10.9.0 -",
    "tvOS: 9.0.0 -",
    "visionOS: 1.0.0 -"
  ],
  "documentType" : "symbol",
  "framework" : "GameController",
  "identifier" : "/documentation/GameController",
  "metadataVersion" : "0.1.0",
  "role" : "Framework",
  "symbol" : {
    "kind" : "Framework",
    "modules" : [
      "Game Controller"
    ],
    "preciseIdentifier" : "GameController"
  },
  "title" : "Game Controller"
}
-->

# Game Controller

Support hardware game controllers in your game.

## Overview

Use Game Controller to support users interacting with your app using a physical or virtual game controller. Game controllers include third-party products, such as the DualShock 4, DualSense, and Xbox, as well as the mouse, keyboard, Siri Remote, and racing wheels.

![An illustration of a laptop displaying a game that shows a car driving on the road toward a country landscape. On the left is an overlay of a steering wheel controller.](images/com.apple.gamecontroller/media-4083651@2x.png)

To support game controllers, add the Game Controller capability (the <doc://com.apple.documentation/documentation/BundleResources/Information-Property-List/GCSupportsControllerUserInteraction> property) to your project, and Xcode adds the Game Controller framework automatically. Then, choose the types of controllers your app supports (the <doc://com.apple.documentation/documentation/BundleResources/Information-Property-List/GCSupportedGameControllers> property) under the Game Controllers capability on the Signing & Capabilities pane.

For controllers other than the racing wheel, follow these steps to process the game controller input in your app:

- To get a physical game controller object, register for specific notifications when users connect and disconnect game controllers. Alternatively, you can display a virtual controller for the user to interact with.
- Then get a profile object from the physical or virtual controller to access its input elements, such as buttons, triggers, thumbsticks, and directional pads. Profiles encapsulate the hardware details and layout of the input elements on the controller from your app.
- To process the input, either get the values directly from the elements or register callbacks for when the user changes their values. Apps running in visionOS receive input events only when the person is looking at the app’s window.
- For controllers that support haptics, you can provide feedback to the user by creating an engine that manipulates the controller’s actuators.

Users may remap game controller elements in Settings and Preferences, so be sure to display the correct input element in your interface. If the [`hasRemappedElements`](/documentation/GameController/GCPhysicalInputProfile/hasRemappedElements) property is <doc://com.apple.documentation/documentation/Swift/true>, the user remapped elements and you can get the mapping between the actual and alias elements using the [`mappedElementAlias(forPhysicalInputName:)`](/documentation/GameController/GCPhysicalInputProfile/mappedElementAlias(forPhysicalInputName:)) and [`mappedPhysicalInputNames(forElementAlias:)`](/documentation/GameController/GCPhysicalInputProfile/mappedPhysicalInputNames(forElementAlias:)) methods.

To support racing wheel devices in your macOS app, see [Racing wheel device support](/documentation/GameController/racing-wheel-device-support).

## Topics

### Essentials

  <doc://com.apple.documentation/documentation/Updates/GameController>

[Discovering game controllers](/documentation/GameController/discovering-game-controllers)

Implement connection and input handling to provide seamless physical controller support for players.

[Handling input events](/documentation/GameController/handling-input-events)

Receive controller input using either polling or callbacks.

### Configuration

  <doc://com.apple.documentation/documentation/BundleResources/Information-Property-List/GCSupportsControllerUserInteraction>

  <doc://com.apple.documentation/documentation/BundleResources/Information-Property-List/GCSupportedGameControllers>

  <doc://com.apple.documentation/documentation/BundleResources/Information-Property-List/GCSupportsMultipleMicroGamepads>

### View controller

[`class GCEventViewController`](/documentation/GameController/GCEventViewController)

A view controller that delivers input either from the responder chain to views, or from game controllers to profiles.

### Game controllers

[Supporting Game Controllers](/documentation/GameController/supporting-game-controllers)

Support a physical controller or add a virtual controller to enhance how people interact with your game through haptics, lighting, and motion sensing.

[Letting players use their second-generation Siri Remote as a game controller](/documentation/GameController/letting-players-use-their-second-generation-siri-remote-as-a-game-controller)

Support the second-generation Siri Remote as a game controller in your Apple TV game.

[Discovering and tracking spatial game controllers and styli](/documentation/GameController/discovering-and-tracking-spatial-game-controllers-and-styli)

Receive controller and stylus input to interact with content in your augmented reality app.

[`protocol GCDevice`](/documentation/GameController/GCDevice)

A protocol that defines a common interface for game input devices.

[`class GCController`](/documentation/GameController/GCController)

A representation of a real game controller, a virtual controller, or a snapshot of a controller.

[`class GCRacingWheel`](/documentation/GameController/GCRacingWheel)

An object that represents a physical racing wheel controller connected to a device.

[`class GCKeyboard`](/documentation/GameController/GCKeyboard)

An object that represents a physical keyboard connected to a device.

[`class GCMouse`](/documentation/GameController/GCMouse)

An object that represents a physical mouse connected to a device.

[`class GCStylus`](/documentation/GameController/GCStylus)

An object that represents a physical stylus connected to the device.

### Game controller profiles

[Input](/documentation/GameController/input)

Receive controller input in the way that best integrates with the flow of your game or game engine.

[`class GCMotion`](/documentation/GameController/GCMotion)

A controller profile that supports orientation and motion.

[`class GCDeviceBattery`](/documentation/GameController/GCDeviceBattery)

The charge level and state of a device’s battery.

[`class GCDeviceHaptics`](/documentation/GameController/GCDeviceHaptics)

The locations of haptic actuators on a game controller.

[`class GCDeviceLight`](/documentation/GameController/GCDeviceLight)

The colored light on a device.

### Virtual controller

[Adding virtual controls to games that support game controllers in iOS](/documentation/GameController/adding-virtual-controls-to-games-that-support-game-controllers-in-ios)

Use touch input and virtual controllers to make your game available to players without controllers.

[`class GCVirtualController`](/documentation/GameController/GCVirtualController)

A software emulation of a real controller that you configure specifically for your game.

### Button elements and names

[`protocol GCTouchedStateInput`](/documentation/GameController/GCTouchedStateInput)

The common properties for an element that has touch state input.

[`protocol GCPressedStateInput`](/documentation/GameController/GCPressedStateInput)

The common properties for an element that has press state input, such as input from a button.

[`typedef NSString<GCButtonElementName> * const GCInputButtonName;`](/documentation/GameController/GCInputButtonName)

The Objective-C type for an input button name.

### Racing wheels

[Racing wheel device support](/documentation/GameController/racing-wheel-device-support)

Add support for racing wheel devices in macOS.

### Game Controller framework migration from IOKit

Deploy an app that takes advantage of advanced game controller features using the Game Controller framework, while supporting game controllers on older macOS releases using IOKit.

[Understanding game controller backward compatibility](/documentation/GameController/understanding-game-controller-backward-compatibility)

Learn how macOS brings support for the latest game controllers to software that predates the introduction of the Game Controller framework.

[`var kIOHIDGCSyntheticDeviceKey: String`](/documentation/GameController/kIOHIDGCSyntheticDeviceKey)

A key that specifies whether the device is a game controller synthetic HID device.

### Aliases for backward compatibility

[`typealias GCDeviceElement`](/documentation/GameController/GCDeviceElement)

An alias for a symbol name for backward compatibility with a previous SDK version.

[`typealias GCDeviceAxisInput`](/documentation/GameController/GCDeviceAxisInput)

An alias for a symbol name for backward compatibility with a previous SDK version.

[`typealias GCDeviceButtonInput`](/documentation/GameController/GCDeviceButtonInput)

An alias for a symbol name for backward compatibility with a previous SDK version.

[`typealias GCDeviceTouchpad`](/documentation/GameController/GCDeviceTouchpad)

An alias for a symbol name for backward compatibility with a previous SDK version.

[`typealias GCDeviceDirectionPad`](/documentation/GameController/GCDeviceDirectionPad)

An alias for a symbol name for backward compatibility with a previous SDK version.

### Deprecated symbols

[Deprecated symbols](/documentation/GameController/deprecated-symbols)

### Classes

[`class GCControllerHomeButtonSettingsManager`](/documentation/GameController/GCControllerHomeButtonSettingsManager-258mu)

Access the game controller system Home button settings.

[`class GCDeviceType`](/documentation/GameController/GCDeviceType)

A class representing a type of spatial accessory.

[`class GCSpatialAccessory`](/documentation/GameController/GCSpatialAccessory)

### Protocols

[`protocol GCPhysicalInputExtents`](/documentation/GameController/GCPhysicalInputExtents)

Physical extents scale the normalized value reported by `GCLinearInput`
into physical units.

### Enumerations

[`enum GCControllerHomeButtonSettingCustomizationStatus`](/documentation/GameController/GCControllerHomeButtonSettingCustomizationStatus)

An additional returned flag indicating whether a setting has been modified
by the user.

[`enum GCControllerHomeButtonSettingInAppAction`](/documentation/GameController/GCControllerHomeButtonSettingInAppAction)

How the system responds to a press of the game controller Home button while
your application is front-most.

[`enum GCControllerHomeButtonSettingSystemAction`](/documentation/GameController/GCControllerHomeButtonSettingSystemAction)

How the system responds to a press of the game controller Home button
outside of contexts where an action of the front-most app takes priority.

[`enum GCControllerHomeButtonSettingsCustomizationActivity`](/documentation/GameController/GCControllerHomeButtonSettingsCustomizationActivity)

A hint passed to `-openControllerHomeButtonSettingsForActivity:` to
indicate the reason the app is requesting to open Settings.

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)