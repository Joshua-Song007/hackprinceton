# Pear Web Studio

The creator app for Pear games: scene, scripts, simulated devices, local and server test runs, live debugging and publishing. It is one TypeScript web app (Vite, dockview-core, CodeMirror 6, three.js) that ships two ways:

- **Browser:** the backend serves the built Studio. Locally it runs on `http://localhost:5173`.
- **Desktop:** Tauri 2 wraps the same build in the OS webview (WebView2 on Windows, WKWebView on macOS) as a native installer with auto-update.

All input in this Studio is simulated. Live AirPods, iPhone and Apple Watch input is only in the native macOS Studio (`Apps/PearStudio`, needs a Mac and Xcode).

Spec: `.claude/plan.md`, section Phase 8. Brand kit: `docs/brand-kit/index.html`. The Studio still uses the previous kit's tokens and components, kept in `src/studio-tokens.css` and `src/studio-components.css`.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22+ | Studio, SDK packages, tests, `demo.sh` |
| Rust (cargo) | stable, on `PATH` (`~/.cargo/bin`) | Backend, and the desktop build |
| Git Bash (Windows) | any | Runs `Deploy/*.sh` |
| Tauri prerequisites | see tauri.app "Prerequisites" | Desktop build only: WebView2 + MSVC build tools on Windows, Xcode command line tools on macOS |

You do not need Docker or Postgres: without `DATABASE_URL` the backend uses an in-memory store (data is lost on restart).

On Windows, call Git Bash by its full path if plain `bash` opens WSL (it then exits 127):

```bash
"C:/Program Files/Git/usr/bin/bash.exe" Deploy/dev.sh
```

## 1. Install

From the repo root:

```bash
cd Web && npm install
```

`Web/` is an npm workspace: `packages/pear-{core,runtime,script,sim,cloud}` (the SDK) and `studio/` (this app).

## 2. Run the dev stack

From the repo root:

```bash
bash Deploy/dev.sh
```

This builds and starts the backend on `http://localhost:8080` (in-memory store, dev sign-in on) and the Studio's Vite dev server on `http://localhost:5173` with hot reload. The first run compiles the backend and takes a few minutes. Ctrl+C stops both.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Backend port |
| `PEAR_DEV_SIGNIN` | `1` | Sign in with any name (no real accounts) |
| `DATABASE_URL` | unset | Set it to use Postgres instead of memory |

## 3. Try it

1. Open `http://localhost:5173`. It opens the Flagship template (Hollow Choir). The project menu in the toolbar also has the Blank template.
2. **Run local** (F5): scene and client scripts run in the page against simulated devices at 50 Hz.
   - AirPods (head): drag in the viewport, arrow keys, or the yaw and pitch sliders in the Devices panel.
   - Phone (gestures): T, F and P send tap, flick and pinch; more buttons are in Devices.
   - Watch: heart-rate slider in Devices.
   - Watch the Output and Packets tabs. Shift+F5 stops.
3. **Sign in** with any name, then create a game and **Publish** in the same sheet.
4. **Run on server**: server scripts run on the backend. The Server tab shows the live session, State shows `ctx.state`.
5. **Add test player**: opens a second tab that joins the same session as another dev account.
6. Publish again while running: every player gets the new version and State resets.

Panels dock, split, tab, resize and collapse. Keyboard: F6 / Shift+F6 move between panels, arrow keys resize a focused splitter, Ctrl+Alt+arrows move a panel, Ctrl+Alt+Shift+arrows split it, Ctrl+Alt+C collapses, Ctrl+Alt+M maximizes. Layouts and Settings (UI scale, theme, reduced motion, server URL) are under Window and Settings.

## 4. Checks

Run these before opening a PR. The server e2e needs `dev.sh` running.

```bash
cd Web && PEAR_E2E_URL=http://localhost:8080 npm test
```

```bash
cd Web && npm run typecheck && npm run build
```

From the repo root, a scripted 2-player round against the backend; it must print `PASS`:

```bash
bash Deploy/demo.sh
```

## 5. Desktop app

Run the desktop shell with hot reload. `tauri dev` starts its own Vite on port 5173, so stop `dev.sh` first and run the backend on its own:

```bash
cd Backend && PEAR_DEV_SIGNIN=1 cargo run
```

```bash
cd Web/studio && npx tauri dev
```

Build the installer:

```bash
cd Web/studio && npx tauri build
```

- Windows output: `src-tauri/target/release/bundle/nsis/Pear Studio_<version>_x64-setup.exe`. macOS (`.app`, `.dmg`) must be built on a Mac or by `.github/workflows/studio-release.yml` (tag `studio-v*`).
- The build ends with "no private key" unless `TAURI_SIGNING_PRIVATE_KEY` is set. The installer is still produced; only the updater signature is missing. Never commit the key.
- Installers are unsigned, so Windows SmartScreen may warn.
- In the desktop app, set Settings, Server URL to `http://localhost:8080` (the default is the page origin, which the desktop app does not have).
- Desktop-only: Window, Pop out puts a panel in its own window; the update check runs at startup.

## Layout

| Path | What |
|---|---|
| `src/main.ts` | Composition root: the only file that wires `@pear/sim` and `@pear/cloud` to the runtime |
| `src/layout.ts` | Docking, presets, saved layouts, keyboard panel control |
| `src/run.ts` | Run local, Run on server, test players, viewport and Devices panel |
| `src/debug-panel.ts` | Console panel: client output and server rows merged, State column, Packets (Advanced) |
| `src/editor.ts`, `explorer.ts`, `inspector.ts` | Script editor, entity tree, entity inspector |
| `src/account.ts`, `preferences.ts`, `project.ts` | Sign-in and publish, settings, project model and autosave |
| `src/theme.css` | Imports `studio-tokens.css` and `studio-components.css` (the previous brand kit); no new colors |
| `src-tauri/` | Desktop shell (Tauri 2) |
| `test/` | Unit tests and the e2e (`e2e.test.ts`) |

Rules: the runtime and script code never import `@pear/sim` (hardware-blind); sensor data never goes to the backend; UI follows the brand kit (sentence case, no emoji, `live` orange never used here).

## Troubleshooting

- **Tests fail with `Unknown file extension ".ts"`**: the test workers already pass `--experimental-strip-types`. Make sure you are on a branch with that fix, or use Node 22.18+.
- **`bash` exits 127 on Windows**: it resolved to WSL. Use the Git Bash path above.
- **Port 5173 or 8080 in use**: Vite uses `strictPort`. Stop the other process, or set `PORT` for the backend.
- **Sign-in fails**: the backend needs `PEAR_DEV_SIGNIN=1` (the `dev.sh` default), and Settings, Server URL must point at it.
- **A test player in a background tab updates slowly**: browsers throttle timers in hidden tabs to about 1 Hz. Keep it visible or in its own window.
