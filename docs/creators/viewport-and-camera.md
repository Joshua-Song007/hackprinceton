# Viewport and camera

| Input | Action |
|---|---|
| Right drag | Rotate |
| Alt + right drag | Rotate around the vertical axis only |
| Middle drag, or Shift + left drag | Pan |
| Scroll wheel | Zoom |
| W A S D | Fly forward, left, back, right (Shift = faster) |
| Q / E | Fly down / up |
| Left click | Select the entity under the cursor (smallest box wins, so contents beat the room around them) |
| Left drag on the selected entity | Slide it on the ground plane, 5 cm steps; one undo step per change |
| F | Frame the selected entity |

Keys work while the viewport has focus (click it once). While a game is running the camera follows the simulated head: WASD walks the player, a click-drag looks around, and the editor camera is off.

The cube with X, Y, Z arrows in the top-right corner shows the world axes from your current view. Axes: +X right, +Y up, -Z forward.

Entities draw as translucent boxes or spheres in their colour; the selection is blue. While running, cones mark players (you in blue, others in red).
