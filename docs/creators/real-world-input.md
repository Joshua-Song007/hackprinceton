# Real-world input

## Simulated and real

Games never know whether input is simulated or live. Every device, real or simulated, produces the same USIS packet (orientation, position, accel, touch, gesture, heart rate); the input layer strips `source` before scripts see anything. Web Studio uses simulated devices, or live phones through the local relay below. AirPods input is in the native macOS Studio.

Real phones reach Web Studio through a local relay: `npm run relay` (in `Web/studio`) listens for the iOS companion over Bonjour (`_pear._tcp`, TCP port 7777) and serves Studio on `ws://127.0.0.1:8787`. In the Test panel set a player's Source to Live and tick the phone. Packets are marked `source: live` for the Packets tab only; scripts still cannot tell. The relay binds localhost and forwards nothing elsewhere. AirPods stay in the native macOS Studio.

Capability tiers: 1 = orientation and touch, 2 = adds position, 3 = adds heart rate.

## Position and proximity

A client script can read `ctx.position` (local meters `[x, y, z]`) only when the scene sets `"permissions": { "location": true }`; otherwise it is `null`. The script decides what to send, for example:

```js
onTick(self, ctx, dt) {
  if (ctx.position) ctx.remote.fire("pos", { x: ctx.position[0], z: ctx.position[2], acc: 2 });
}
```

The server never receives raw sensor data, only what scripts send as remote events. The rule: derived game events leave the device, raw streams do not. A "Sharing location" indicator for games that ask for location is planned for live devices and is not built yet; the web Studio simulates position as a phone GPS fix, 1 per second, with drift and noise. Move the player with WASD, and set the error with the "GPS accuracy" slider (0 to 15 m) in the Test panel Controls. Scripts read it as `ctx.positionAccuracy` (meters, `null` without the location permission or a fix).

## Tag with phones and AirPods

Real-world tag needs a phone's GPS for position and AirPods or a phone's motion for the "tag hand" gesture. GPS is accurate to 3 to 10 m, so tagging should combine reported accuracy with range (a tag game's server can: range plus both players' `acc`). The native work (a location source on the companion, Nearby Interaction for touch range) is specified in `docs/agents/gps-proximity-spec.md` and is not built yet.

## Custom motion gestures

A scene can define motion gestures (`gestures` in `scene.json`, see Scene format) that fire `onGesture` when a device's acceleration along an axis passes a threshold. They run on acceleration, so the simulated phone (Test panel > "Swing (motion)" style buttons) and a real phone's accelerometer take the same code path, and scripts cannot tell them apart.
