Omni is a macOS app for building games that take input from every Apple device a player carries: AirPods head pose, iPhone motion and touch, Apple Watch heart rate and gestures. Omni Studio is a professional tool that people sit in for hours, so it borrows the conventions creators already know from Xcode, Reality Composer Pro, Blender, Unity, Figma and browser DevTools, and spends its own personality in very few places.

## Principles

- **The viewport is the work.** Chrome is flat, mid-grey and quiet so the scene reads. Panels never compete with it for color or contrast.
- **Familiar beats novel.** Where a convention exists on macOS or in 3D tools, follow it: Run and Stop in the toolbar, inspector on the right, X/Y/Z in red, green and blue, drag-to-scrub number fields, a debug area with tabs.
- **State lives in the chrome.** Whether real hardware is driving the scene is shown by the window itself (toolbar edge and status bar in `live`), never only by a small badge.
- **Numbers over adjectives.** Show `50 Hz`, `58 ms`, `Stale 1.2 s`. Never "fast", "laggy" or "offline".
- **Every problem says how to fix it,** in one sentence with one button.

## Voice

- Sentence case for every label, title, button and menu item. No all-caps labels.
- Buttons are verbs that say what happens: "Calibrate", "Record 10 s", "Add Virtual Watch". The result uses the same verb: "Calibrated".
- Use the platform's terms exactly: `deviceId`, `slot`, `seq`, Simulator, Live devices, Tier 1/2/3.
- Errors name what happened and the fix, with no apology: "Lantern Hunt reads heart rate (Tier 3), and no connected device provides it."
- Separate values with layout (columns, rows), not with punctuation strings like "A · B · C". No arrows in labels.
- No emoji, no exclamation marks.

## Color

- Chrome: `bg-window` for toolbar and status bar, `bg-panel` for sidebars, inspector and debug area, `bg-field` for fields, tables and code. Split panels with `line` hairlines; no shadows, no cards.
- `viewport` is a mid-grey, as in Blender and Unity, so both bright and dark geometry stay legible.
- `accent` (blue) is the macOS control accent: focus rings, the default button, selected rows, links and the selection outline in the viewport. Selected rows in a focused list fill with `accent` and use `on-accent` text; unfocused selections use `bg-selected`.
- `live` (orange) means one thing: real devices are driving the scene. It appears on the Live segment, the toolbar's bottom edge and the status bar fill, and nowhere else.
- `axis-x`, `axis-y`, `axis-z` appear only on axis letters, gizmos and vector components in JSON. World up is +Y.
- `ok`, `warn`, `error` are for status, always with a word, a count or an icon; a stale device is grey with a hollow ring, not a color.
- Control borders are `line-control` (3:1 on every chrome surface). Focus is a 2px `focus` ring.

## Type

- One family: the system font (SF Pro on macOS). In SwiftUI use the system text styles; on the web the `sans` stack falls back to Segoe UI and system-ui.
- Studio sizes follow the macOS scale: `body` 13px for most text, `small` 11px for field labels, table cells and dense panels, `headline` 13px semibold for section titles, `title` 15px semibold for the selected entity and sheet titles.
- Numbers in fields and tables use the sans face with tabular figures. `code` (SF Mono) is only for JSON, scripts and ids you would type.
- Brand type is the same family at display size: `display` 600 weight, tight tracking, for the cover, landing page and slides.

## Layout and sizing

- Controls are 24px tall (`control-height`), list rows 28px (`row-height`), packet-log rows 22px (`table-row-height`).
- Spacing: 4px base. `space-2` between controls, `space-3` panel inset, `space-4` between blocks.
- Radii: `radius-control` (5px) on buttons, fields and segmented controls; `radius-window` (10px) on windows, sheets and popovers. Nothing else is rounded.
- Studio follows the StudioWindow layout. Sidebar 240px, inspector 280px, debug area 200px; the viewport takes the rest. Collapse the inspector first when space runs out.
- Hardware-blind rule: the packet source shows only in the device list grouping and the debug area. Nothing a game or script reads exposes it.

## Motion

- Motion only answers something: a section expanding (120 ms), a haptic ring when an output command arrives, the selection moving. No ambient or entrance animation.
- With reduced motion, swap movement for a static state of the same duration.

## Iconography

- SF Symbols in the native app, monochrome, `text-secondary` by default and `text` when active. Devices: `airpodspro`, `applewatch`, `iphone`, `applepencil`; Run `play.fill`, Stop `stop.fill`; issues `exclamationmark.triangle.fill`.
- The line icons drawn in these previews stand in for SF Symbols on the web and are approximations. Use real SF Symbols in anything Apple-platform.

## Logo

- The mark is a coordinate gizmo: Y up in green, X in red, Z in blue, meeting at an origin. Use `omni-gizmo-light.svg` on light grounds and `omni-gizmo-dark.svg` on dark ones (Logos group). Set the name beside it in the system font, semibold.

## SwiftUI

- Mirror each color token as a Color Set with Any and Dark appearances, named the same: `Color("bg-panel")`. Prefer system colors where they match (`Color.accentColor` for `accent`).
- Sizes, spacing and radii go in one `OmniTheme` enum in the OmniStudio target. Packages never import it.
