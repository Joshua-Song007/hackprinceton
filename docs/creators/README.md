# Pear Studio creator docs

Pear Studio is where you build games for Pear: a 3D scene, scripts that run on each player's device, and an optional server script that owns shared state. You can test everything on one computer with simulated devices.

Read in this order:

1. [getting-started.md](getting-started.md): build and Play a first game in ten minutes; the mental model.
2. [studio-guide.md](studio-guide.md): every menu, panel and shortcut.
3. [viewport-and-camera.md](viewport-and-camera.md): moving around the 3D view and moving entities.
4. [scene-format.md](scene-format.md): what `scene.json` can contain.
5. [scripting-api.md](scripting-api.md): every handler, `self` and `ctx` member, and the limits. Generated from `Web/studio/src/api.ts`; do not edit by hand.
6. [testing-and-multiplayer.md](testing-and-multiplayer.md): Play, adding and driving players, test players, reading the debug panels.
7. [publishing.md](publishing.md): sign in, publish, versions.
9. [real-world-input.md](real-world-input.md): simulated vs real devices, positions, GPS, and what leaves your machine.

Run Studio locally with `Deploy/dev.sh`, which prints the URL.
