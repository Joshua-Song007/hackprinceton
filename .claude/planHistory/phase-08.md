## Phase 8: Omni Web Studio & Live Hosting (active, 2026-11-14)

(Numbered 8, placed here because it is the active work; Phase 6 is deferred and Phase 7 stays unscheduled, so existing 6/7 references keep their numbers.)

Goal: a live code editor people can use today, wired to everything `Backend/` already does: sign in, create a game, edit scene and scripts, run it locally against simulated peripherals, run its server scripts on the hosted game server, debug that live session (state, events, errors, logs), and publish. Packaged as its own native executable, installed and distributed like Roblox Studio (installer, versioned download, auto-update), and the same build is served by the backend on Vultr for browser use. Every window region is a dockable, resizable, hideable panel the developer arranges to fit their needs; layouts and accessibility preferences persist per user.

FLAGGED (overview.md mismatch, not decided): overview.md Module 7 defines Omni Studio as a native macOS SwiftUI app. Phase 8 adds a second, web-technology Studio (browser + desktop executable) next to it; it does not replace `Apps/OmniStudio`. Needs a user decision to update overview.md.

Roblox Studio is the model: Roblox ships a Studio, an engine API, templates (Baseplate), a local test server, Publish, and a live server console. Omni's equivalents:

| Roblox Studio | Phase 8 |
|---|---|
| Studio app | `Web/studio` (browser) + `Web/studio/src-tauri` (desktop executable) |
| Engine + Luau API | `Web/packages/*` SDK (`@omni/core`, `@omni/runtime`, `@omni/script`, `@omni/sim`, `@omni/cloud`), same contracts as the Swift packages |
| Baseplate templates | `Games/Flagship` (and a blank template) opened straight from the repo, never copied |
| Play / Play Solo | Run local: scene + client scripts in the browser, simulated devices |
| Start Server + Players | Run on server: server scripts run in `Backend/` QuickJS session on Vultr, N simulated players in tabs |
| Developer Console (server) | Debug panel: live `ctx.state`, remote events in/out, joins, script errors, `console.log` from server scripts |
| Publish to Roblox | Publish: `POST /api/games/{id}/versions` |

Rules for every Phase 8 item:
- Shared contracts are files, not copies: `Schema/usis.schema.json`, `Packages/OmniScript/Sources/OmniScript/Resources/prelude.js`, the `scene.json` shape of `SceneLoader.swift`, the `/play` frame `{"name","data"}`. The TS SDK imports them (Vite `?raw` / JSON import), so a contract change reaches Swift, Rust and TS at once.
- Hardware-blind rule holds in TS: `@omni/runtime` and `@omni/script` never depend on `@omni/sim`; the input layer strips `source` before the runtime; only the Studio debug panel sees it. Enforced by each `package.json` `dependencies`.
- Network Rule holds: sensor data (USIS) never goes to Vultr. Simulated devices run inside the Studio process; only remote events (game content) reach `/play`. Live iPhone / AirPods input stays in `Apps/OmniStudio` (macOS) for now.
- UI derives from `docs/brand-kit/`: `tokens.css` + `components/bundle.css` imported as-is, StudioWindow layout as the default layout (sidebar 240px, inspector 280px, debug area 200px, viewport takes the rest; user can rearrange from there), sentence case, numbers over adjectives, `live` orange only for real hardware (never in Phase 8 since all input is simulated), no emoji.
- Server is authoritative for game state: `ctx.state` lives in the backend session; Studio only displays it.
- Customizable windows (accessibility): every panel (Explorer, Viewport, Inspector, Script editor, Output, Server, State, Packets, Devices) docks, splits, tabs, resizes, collapses, pops out into its own OS window (desktop) and can be reset; full keyboard path for all of it (move focus between panels, resize splitters with arrow keys); preferences for UI scale (90-200%), editor font size, theme (dark / light / high contrast from brand-kit tokens), reduced motion, and focus-ring always on. Saved layouts: default StudioWindow, Script focus, Debug focus, plus user-named ones.
- Stack: TypeScript + Vite, npm workspaces, vitest, three.js (viewport), CodeMirror 6 (editor), dockview-core (docking panels, no framework), Tauri 2 (native executable, updater plugin). JS deps tracked in `Web/package-lock.json`, Rust in each `Cargo.lock`; `branchDep.md` stays Swift-only.
- Done = `npm test` and `cargo test` pass, and the item is exercised by `Deploy/dev.sh` end to end.

### 8.1 Backend — live integration (changes to Phase 4.2 files)
- [x] `Backend/Cargo.toml` — add `tower-http` (features `cors`, `fs`) for CORS and static Studio serving; nothing else.
- [x] `Backend/src/main.rs` — run `db::migrate` at startup when a pool exists (log and continue on failure); read `OMNI_STUDIO_DIR`. (migrate awaits before bind: unreachable DB delays startup ~30 s.)
- [x] `Backend/src/lib.rs` — CORS layer (origins from `OMNI_CORS_ORIGINS`, default allows the Tauri origins and `http://localhost:5173`); serve the built Studio from `OMNI_STUDIO_DIR` at `/` with SPA fallback; mount `game_server::debug::routes()`. (`app_with_studio(db, dir)` added; `app(db)` unchanged.)
- [x] `Backend/src/api/accounts.rs` — `authenticate` also accepts `?token=` (browsers cannot set headers on a WebSocket); header wins when both are present. (Token in a URL can reach proxy logs; TLS via Caddy only [provisional: needs-tien-review].) (new `authenticate_request(headers, query)`; REST stays header-only; bad header never falls back to query.)
- [x] `Backend/src/game_server/session.rs` — before `join`, fetch the game's latest version and pass its `server_scripts` sources to the registry (replaces the `NoopHost`-only factory); `?version=<n>` picks a version; a newer version for a game with a live session restarts that session's host (`reload` event `{"name":"_reload"}` to players); emits every join, leave, inbound and outbound frame to the debug bus. (after `_reload` the new host gets `onPlayerJoin` per connected player with empty `ctx.state`; joiners enter the live session whatever `?version` [provisional: needs-tien-review]; old NoopHost header lines now stale, FLAGGED.)
- [x] `Backend/src/game_server/script_host.rs` — `factory()` takes sources from the session (no lookup stub); `console.log/warn/error` inside server scripts captured (capped like `errors()`); after each handler, state JSON and new errors/logs published to the debug bus. (`HostFactory` = `(game_id, sources)`, `factory_with` removed; console capture max 100 events/call, 2000 chars; `state` sent only on change.) (fix: a line-leading `export default` after comments is rewritten, same rule as ScriptEngine.swift, so unmodified Flagship `game.js` loads; load failure printed to stderr and kept in the `/debug` snapshot until the session ends.)
- [x] `Backend/src/game_server/debug.rs` — owner-only WebSocket `GET /debug/{game_id}`: on connect sends a snapshot (players, version, `ctx.state`, last 100 logs/errors), then streams `{"kind":"join|leave|in|out|log|error|state|reload", "t", ...}`; bounded per-subscriber queue (drop oldest), never blocks the session. (256-frame queue per subscriber; 400 non-uuid id, 404 unknown game, 503 no DB.)
- [x] `Backend/src/memstore.rs` — in-memory store used when `DATABASE_URL` is unset (accounts, games, versions behind the same db.rs function signatures), so `Deploy/dev.sh` runs locally with no Postgres or Docker; data lost on restart. (Vultr uses its own Postgres; local demo needs nothing installed beyond cargo + node.) (`db::Db { Pg, Mem }` enum, db.rs query fns take `&Db`; `app(None)` still = no DB / 503, memory only when main sees DATABASE_URL unset; invalid DATABASE_URL still starts with no DB [provisional: needs-tien-review].)
- [x] `Backend/tests/live.rs` — publish a server script, open `/play` with `?token=`, send a remote, get the reply; `/debug` sees `join`, `in`, `out`, `state`; non-owner `/debug` is 403. Skips without `DATABASE_URL` like `tests/api.rs`.

### 8.2 Web SDK packages (`Web/packages/*`, mirror the Swift package boundaries)
- [x] `Web/package.json` — npm workspaces (`packages/*`, `studio`), scripts `dev`, `build`, `test`; dev deps typescript, vite, vitest.
- [x] `Web/tsconfig.base.json` — strict TS shared by every package.
- [x] `Web/packages/omni-core/src/usis.ts` — USIS v1 packet types and validator generated by hand from `Schema/usis.schema.json` (imported, checked in a test); `Pose`, vec3, quaternion helpers. No I/O, no deps. (also enforces 128-char deviceId and 0.01 quaternion tolerance from PacketValidator.swift, not in the schema file.)
- [x] `Web/packages/omni-core/test/usis.test.ts` — valid packets from `Recordings/demo-fallback.usis.jsonl` pass; each schema rule has a failing case.
- [x] `Web/packages/omni-runtime/src/scene.ts` — load `scene.json` (same shape and errors as `SceneLoader.swift`): entity tree, transforms, components `trigger`, `audioEmitter`, `script`; `runMode`, `clientScripts`, `serverScripts`.
- [x] `Web/packages/omni-runtime/src/input.ts` — `InputBus`: latest sample per slot, strips `source`, stale after 500 ms; one `InputFrame` per tick.
- [x] `Web/packages/omni-runtime/src/events.ts` — derived events from `InputFrame` + scene: head-probe `onTriggerEnter` / `onTriggerExit` (sphere, box), `onLookAt` (head forward ray vs entity bounds), `onGesture`, `onHeartRate`. (lookAt = forward ray vs unit box, 0.5 s dwell, Swift uses 15° cone; head probe falls back to `playerOrigin` without position [provisional: needs-tien-review].)
- [x] `Web/packages/omni-runtime/src/viewport.ts` — three.js render of the scene: boxes for entities, floor grid, axis gizmo, selection outline, head-pose camera; colors from brand-kit tokens (`viewport`, `viewport-grid`, `accent`, axis colors). (no test: no WebGL in Node.)
- [x] `Web/packages/omni-runtime/test/runtime.test.ts` — `Games/Flagship/scene.json` loads; trigger enter/exit and lookAt fire from scripted head poses.
- [x] `Web/packages/omni-script/src/sandbox.ts` — client scripts in one Web Worker per run: evaluates shared `prelude.js` (`?raw` import), same leading `export default` rewrite as `ScriptEngine.swift`; handlers get `(self, ctx, ...)`; `ctx.haptic`, `ctx.remote.fire(name, data)`, `self.audio.play`, `self.position`; per-call 250 ms watchdog (worker terminated, error reported); errors and `console.*` routed to the Studio Output tab. (`new Function` + `with`: Tauri CSP needs `unsafe-eval`; killed worker restarts with scripts reloaded, per-entity state lost; isolation = worker has no DOM, not a security boundary, FLAGGED.)
- [x] `Web/packages/omni-script/test/sandbox.test.ts` — Flagship `player.js` / `enemy.js` load; an unknown handler is rejected with prelude's message; an infinite loop is stopped.
- [x] `Web/packages/omni-sim/src/devices.ts` — virtual AirPods (head yaw/pitch from viewport mouse-look), phone (gesture keys: tap, flick, pinch), watch (heart-rate slider); emit USIS packets with `source: "sim"` at 50 Hz.
- [x] `Web/packages/omni-sim/src/playback.ts` — `.usis.jsonl` playback on the device clock (demo fallback recording), loop option.
- [x] `Web/packages/omni-cloud/src/client.ts` — typed client for every backend route: signin, me, signout, games list/create, publish, fetch version, `/play` socket (auto-reconnect with backoff), `/debug` socket. Server URL configurable (default: same origin; desktop default from settings).
- [x] `Web/packages/omni-cloud/test/client.test.ts` — request shapes and error mapping against a stubbed `fetch`; 401 surfaces as a typed error, not a throw-loop.

### 8.3 Web Studio app (`Web/studio`)
- [x] `Web/studio/index.html` — window shell: toolbar, dock area (panels mounted by `layout.ts`), status bar. (fix round 1 from the brand-kit/a11y review: UI scale on sheets/menus, collapse panel Ctrl+Alt+C, split Ctrl+Alt+Shift+arrows, focus kept across live re-renders, roving packet rows, token-only CodeMirror, gesture keys on the canvas only; skipped review items 14, 18, 20, 22-25, 27; none checked visually.)
- [x] `Web/studio/src/layout.ts` — docking layout manager on dockview-core: register panels, default StudioWindow layout + presets (Script focus, Debug focus), save / load / reset named layouts (localStorage), keyboard focus cycling between panels (F6 / Shift+F6) and arrow-key splitter resize, pop-out to a separate window on desktop. (Panel ids are stable strings so saved layouts survive upgrades.) (every debug tab is its own dockview panel, tabbed in the StudioWindow regions by default; arrow-key splitter resize via a synthesized drag; extra keys Ctrl+Alt+arrows move panel, Alt+PgUp/PgDn tabs, Ctrl+Alt+M maximize, F5/Shift+F5 run/stop; pop-out = `popOut` hook, hidden in the browser [provisional: needs-tien-review].)
- [x] `Web/studio/src/preferences.ts` — per-user settings: UI scale, editor font size, theme (dark / light / high contrast), reduced motion (also honors `prefers-reduced-motion`), server URL; applied as CSS variables on `:root`; Settings sheet. (UI scale via CSS `zoom`; server URL defaults to http://localhost:8080 in dev, page origin in the built app.)
- [x] `Web/studio/src/theme.css` — imports `docs/brand-kit/project/tokens.css` and `components/bundle.css`; layout sizes from the brand kit; no new colors. (high contrast = dark tokens remapped, no new colors.)
- [x] `Web/studio/src/project.ts` — project model: scene + client/server script sources + metadata; open template (`Games/Flagship`, blank), open from cloud (latest version), dirty tracking, local autosave (IndexedDB).
- [x] `Web/studio/src/editor.ts` — CodeMirror 6 JS editor per script, tabs, inline error markers from sandbox and server errors, Ctrl+S saves. (sandbox errors carry no line numbers: markers go on the named handler's line or line 1; Ctrl+S = local recovery copy, not publish.)
- [x] `Web/studio/src/explorer.ts` — entity tree + Scripts (client, server) list; add / rename / delete script; select entity. (viewport has no picking: select from Explorer only.)
- [x] `Web/studio/src/inspector.ts` — selected entity: name, Vector3 fields (position, scale; drag-to-scrub, brand-kit Vector3Field), components; edits update the scene JSON. (no rotation field: scene rotation is a quaternion.)
- [x] `Web/studio/src/run.ts` — Run local (runtime + sandbox + sim devices in the page) and Run on server (publish draft version, join `/play/{id}` as player 1; "Add test player" opens another session in a new tab); Stop; status bar shows rate, latency, players. (Run on server publishes a new version each run; test player = `/?join=<game>&version=n&as=<name>`, a second in-memory dev account; its tab cannot see `/debug` (owner-only) [provisional: needs-tien-review].)
- [x] `Web/studio/src/debug-panel.ts` — debug area tabs: Output (client logs/errors), Server (`/debug` stream: logs, errors, events in/out), State (live `ctx.state` JSON tree), Packets (USIS log with `source`, brand-kit PacketLog).
- [x] `Web/studio/src/account.ts` — sign-in sheet (dev sign-in: provider `dev` + name), server URL setting, game picker, Publish with version shown.
- [x] `Web/studio/src/main.ts` — composition root: wires SDK packages to panels (the only file that imports `@omni/sim` and `@omni/cloud` together with the runtime).
- [x] `Web/studio/test/e2e.test.ts` — headless: open Flagship template, Run local, simulated head pose enters Sanctuary, `player.js` handler runs; against a running backend (skip if `OMNI_E2E_URL` unset): sign in, publish, Run on server, `banish` x3 gives `round: won` in the State tab data. (server part passes against the real in-memory backend from `Deploy/dev.sh`: 60/60 with `OMNI_E2E_URL=http://localhost:8080`.)

### 8.4 Desktop executable
(DECISION 2026-11-14, Tien: keep Tauri 2. UI renders in the OS webview (WebView2 / WKWebView), distributed as a native installer; native-control UI (SwiftUI/WinUI) not pursued for this Studio.)
- [x] `Web/studio/src-tauri/Cargo.toml` — Tauri 2 shell crate (separate Cargo project, not a Backend dependency). (crate `omni-studio`; `cargo check` exits 0, Jev gate 0.70 < 0.8 only because the evidence is one `Finished` line.)
- [x] `Web/studio/src-tauri/tauri.conf.json` — app id `dev.omni.studio`, product name `Omni Studio`, window 1440x900 min 1024x640, remembers size/position, bundles `nsis` (Windows installer .exe, per-user install, Start menu entry) and `app`/`dmg` (macOS); brand-kit gizmo icon; updater endpoint on the Vultr host. (updater endpoint = GitHub `releases/latest/download/latest.json`, no Vultr domain yet [provisional: needs-tien-review]; pubkey embedded, private key `~/.tauri/omni-studio.key` outside the repo; CSP allows `unsafe-eval`, `blob:` workers, any http/ws `connect-src`; NSIS built locally: `src-tauri/target/release/bundle/nsis/Omni Studio_0.1.0_x64-setup.exe`, 2.6 MiB, unsigned.)
- [x] `Web/studio/src-tauri/src/main.rs` — starts the window on the built Studio; registers the updater and window-state plugins; one command to open a popped-out panel window; no other Rust logic (all logic stays in the web build so browser and desktop are one code path). (pop-out = dockview `addPopoutGroup` + `public/popout.html`, `window.open` allowed by an `on_new_window` handler (main window built in `setup`); `open_panel_window` registered but unused; pop-out unverified (headless), macOS untested.)
- [x] `.github/workflows/studio-release.yml` — on tag `studio-v*`: build the Windows installer and macOS dmg, sign if secrets exist (unsigned otherwise, flagged), attach to a GitHub Release and publish the updater manifest the desktop app polls. (Code-signing certificates are a human purchase; not decided.) (tauri-action@v0, macOS universal, `latest.json` attached to the GitHub Release; missing secrets = `::warning::`, not a failure; only YAML-parse checked, never run on CI.)
- [x] `Deploy/download.html` — download page served by the backend at `/download`: latest installer per OS, version, release notes link (brand-kit Cover styling). (Dockerfile copies it to `<studio>/download/index.html` + `tokens.css`; release list fetched client-side from the GitHub API, tags `studio-v*`; not served by `dev.sh`.)

### 8.5 Hosting on Vultr (deploy, live debug, run)
- [x] `Deploy/Dockerfile` — multi-stage: Node builds `Web/studio`, Rust builds `Backend/` (whole repo context: `prelude.js` edge), slim runtime image with the binary + Studio at `OMNI_STUDIO_DIR`. (never built: no Docker in this session.)
- [x] `Deploy/docker-compose.yml` — `backend`, `postgres` (local / single-box Vultr; skipped when `DATABASE_URL` points at an external Postgres via profile), `caddy`; health checks; restart unless-stopped. (never run; a `$` in `DATABASE_URL` may be mangled by `env_file`, untested.)
- [x] `Deploy/Caddyfile` — HTTPS for `$OMNI_DOMAIN` (or IP with internal TLS), reverse proxy with WebSocket upgrade for `/play/*` and `/debug/*`. (IP case via `OMNI_CADDY_GLOBAL=local_certs` written by bootstrap; never run.)
- [x] `Deploy/vultr-bootstrap.sh` — run once on a fresh Vultr Ubuntu 24.04 instance over ssh: install Docker, open 80/443, clone the repo, write `.env` (prompted `DATABASE_URL`, `OMNI_DOMAIN`, `OMNI_DEV_SIGNIN`), `docker compose up -d --build`; re-run = update (git pull + rebuild). Human-only steps: create the instance and DNS record, paste secrets. (dev sign-in prompt defaults to 0, demo needs 1; curl-pipe from GitHub `main` needs the repo public; ufw vs Docker-published ports unverified; never run.)
- [x] `Deploy/dev.sh` — one local command, no Docker: `cargo run` backend (in-memory store unless `DATABASE_URL` is set) (`OMNI_DEV_SIGNIN=1`), Vite dev server; prints the Studio URL. Same env names as Vultr so local = hosted. (Vite dev server crashed with `EBUSY` watching `Web/studio/src-tauri/target` while cargo built the desktop app; fix = `server.watch.ignored: ['**/src-tauri/**']` in `Web/studio/vite.config.ts`, not applied, FLAGGED.)

### 8.6 Live demo (humans see the backend working)
- [x] `Web/studio/src/templates/blank.ts` — blank template: floor, one cube with a client script and a server script that counts clicks into `ctx.state` (shows Run on server + State tab in under a minute).
- [x] `Deploy/demo.sh` — scripted check of the hosted or local stack: health, dev sign-in, create game, publish Flagship, open `/play` as 2 players + `/debug`, play a round (`banish` x3), print the event log and final `ctx.state`; exit non-zero on any mismatch. (Node `fetch`/`WebSocket` after a curl `/health`; `OMNI_INSECURE=1` for a self-signed IP box; passes locally against the in-memory backend with Flagship scripts unmodified.)

Not file-bound: demo run on the Vultr box from the desktop executable; two people on two machines in one server session; first-pass UI review against the brand kit, then iterate the frontend from what humans see.

## Later changes

### 2026-11-14 — Projects gallery
Paths: `Web/studio/src/projectsScreen.ts`, `Web/studio/src/recent.ts`, `Web/studio/src/thumbnail.ts`, `Web/studio/src/project.ts`, `Web/studio/src/theme.css`, `Web/studio/src/main.ts`, `Web/packages/omni-runtime/src/viewport.ts`, `Web/packages/omni-runtime/src/orbit.ts`

The Projects screen is a gallery of tiles in two columns (one under 640 px): a rendered preview on the left; name, location, last opened, last edited and Open on the right. Previews are rendered in the browser from the scene JSON by one shared offscreen `Viewport` (`Viewport.snapshot`, framed by `contentBounds`, which ignores floors), queued one at a time, started when a tile scrolls into view, cached in IndexedDB by a content stamp (cloud `updated_at`, local `savedAt`, draft time). "Last opened" is recorded per browser when Open is pressed (no backend field); "Last edited" is the cloud `updated_at`, the local save time or the draft autosave time. Rows sort by the later of the two. Not seen in a browser: tile look, framing, IntersectionObserver in the fixed screen scroller. Stale comments kept: `recent.ts` `ProjectRow.time` ("the draft") and the `mergeProjects` doc, `projectsScreen.ts` header ("one list of ..."). Not changed: the gallery "Open file..." path does not call `rememberRecent` (as before).
- [x] `Web/studio/src/thumbnail.ts` — shared offscreen preview renderer and render queue.
- [x] `Web/studio/src/projectsScreen.ts` — tiled gallery.
- [x] `Web/studio/src/recent.ts` — opened times, `formatWhen`, thumbnail cache, activity sort.
- [x] `Web/studio/src/project.ts` — draft autosave time (`current-at`).
- [x] `Web/studio/src/theme.css` — gallery grid and tile styles; old row styles removed.
- [x] `Web/studio/src/main.ts` — File > Open records the open time.
- [x] `Web/packages/omni-runtime/src/viewport.ts` — `snapshot()`.
- [x] `Web/packages/omni-runtime/src/orbit.ts` — `contentBounds()`.

### 2026-11-14 — Projects gallery comments updated
Paths: `Web/studio/src/recent.ts`, `Web/studio/src/projectsScreen.ts`

The three comments the gallery entry above lists as stale (`ProjectRow.time`, the `mergeProjects` doc, the `projectsScreen.ts` header) were rewritten on request; no code changed.

### 2026-11-14 — Projects screen v2
Paths: `Web/studio/src/projectsScreen.ts`, `Web/studio/src/recent.ts`, `Web/studio/src/thumbnail.ts`, `Web/studio/src/theme.css`, `Web/studio/index.html`, `Web/packages/pear-runtime/src/viewport.ts`, `Web/packages/pear-runtime/src/orbit.ts`

The Projects screen has a sticky full-width top bar (title, centered search and sort, a larger New project button with a plus icon) and a left column with the profile (avatar, name, Sign out), statistics (total, solo, shared, in the cloud, on this computer), Open file and Back to editor. The tiles are in a "Solo" and a "Shared" section. Solo = local projects, the draft and cloud games owned by the account; Shared = cloud games owned by another account (the backend lists only owned games, so Shared stays empty until sharing exists). Search filters by title (debounced 150 ms); sort is Last activity, Last edited, Last opened or Name, saved in `localStorage` (`pear.studio.gallery.sort`). Tiles show a source tag (Cloud, This computer, Draft) in place of the location line; Remove is a quiet button. Previews hide the floor grid and axes and frame tighter (`frameBox` margin 1.8); `THUMB_STYLE` is part of the cache stamp, so older previews were re-rendered. The gallery and login use a darker Pear palette (Emerald and Tea pulled down in value, contrast computed) scoped to `.scr`, dark theme only; gallery buttons are 32 px and New project is 44 px. Not built, now Phase 11 in `plan.md`: Published stat and real Shared data (backend), a New project tile, relative dates, Pear styling for sheets, menus and the editor, bundled Fraunces and Geist. Not changed: the gallery keeps "Open file..." (three periods) because every menu label uses three periods. Not seen in a browser: sticky behavior, search focus, preview framing, colors. Stale comments kept: `recent.ts` line 1 (file header), `projectsScreen.ts` line 1 (header), `viewport.ts` `snapshot` doc ("draws without the axis gizmo"). The `omni-runtime` paths in the entries above are the old names of `pear-runtime`.
- [x] `Web/studio/src/projectsScreen.ts` — bar, profile column, Solo and Shared sections, search and sort.
- [x] `Web/studio/src/recent.ts` — `scope`, `sortProjects`, `filterProjects`, `projectStats`, `loadSort`, `saveSort`.
- [x] `Web/studio/src/thumbnail.ts` — `THUMB_STYLE`, `thumbStamp`, colors read from the screen.
- [x] `Web/studio/src/theme.css` — dark Pear tone, sticky bar, two-column shell, larger controls.
- [x] `Web/studio/index.html` — plus icon.
- [x] `Web/packages/pear-runtime/src/viewport.ts` — `guides` group hidden in `snapshot()`.
- [x] `Web/packages/pear-runtime/src/orbit.ts` — `frameBox` margin.

### 2026-11-14 — Studio colors
Paths: `Web/studio/src/studio-tokens.css`, `Web/studio/src/studio-components.css`, `Web/studio/src/theme.css`, `Web/studio/src/ui.ts`, `Web/studio/src/explorer.ts`, `Web/studio/src/thumbnail.ts`, `Web/packages/pear-runtime/src/viewport.ts`, `Web/studio/test/tokens.test.ts`, `Web/packages/pear-runtime/test/viewport-colors.test.ts`

The Studio keeps its charcoal neutrals and takes the Pear brand accents. Dark: accent Tea `#c2efb3`, text on it Emerald `#285943`, selected rows `#24402f`, ok Tea. Light: accent Emerald, text on it Paper, selected rows `#d5e6d6`, ok Emerald. A new `--selection` token (Sandy dark, Clay light) colors a selected entity in the viewport (`ViewportColors.selection`), because Tea against the unselected white edges is 1.02:1; the self-player pin stays on the accent. Warn, error, Live and the axis colors keep their hues (the kit's pale warn and error are 1.12:1 apart; Live orange must not blend into Sandy). The gallery and login no longer have their own green palette (this supersedes the dark Pear palette in "Projects screen v2"); they inherit the global tokens, so sheets and menus match over them. `THUMB_STYLE` is now `pear-charcoal-1`, so previews re-render once. Disabled controls are at .55 opacity (was .4). The script-row Delete button has coral text through a new `danger` option on `button()` (`om-btn--danger`). Differences from the staged plan: `danger` is a flag next to `variant` (rows use `variant: 'small'`), and the sheet's "Delete script" button was left alone (it is a filled default button, where coral text would fail). `readViewportColors()` needs `document`, so the runtime test covers the defaults only. A contrast test (`tokens.test.ts`) reads the real `studio-tokens.css`. Not seen in a browser: Publish button, tab underline, checkboxes, menu hover fill, selected entity, Live mode, light theme. Stale comments kept: `studio-tokens.css` header ("generated from tokens.json", no generator exists) and the `--accent` comment ("the viewport selection outline", now `--selection`); `viewport.ts` `DARK_VIEWPORT_COLORS` doc ("tokens.css").
- [x] `Web/studio/src/studio-tokens.css` — accent, on-accent, selected row and ok values; `--selection`.
- [x] `Web/studio/src/studio-components.css` — disabled opacity; `om-btn--danger`.
- [x] `Web/studio/src/theme.css` — green gallery override removed; disabled menu opacity.
- [x] `Web/studio/src/ui.ts` — `danger` option on `button()`.
- [x] `Web/studio/src/explorer.ts` — script-row Delete uses `danger`.
- [x] `Web/studio/src/thumbnail.ts` — `THUMB_STYLE` `pear-charcoal-1`.
- [x] `Web/packages/pear-runtime/src/viewport.ts` — `selection` color, used for the selected entity.
- [x] `Web/studio/test/tokens.test.ts` — contrast checks on the real tokens.
- [x] `Web/packages/pear-runtime/test/viewport-colors.test.ts` — selection default differs from accent and text.

### 2026-11-14 — Peripherals panel
Paths: `Web/packages/pear-runtime/src/scene.ts`, `Web/studio/src/needs.ts`, `Web/studio/src/run.ts`, `Web/studio/src/peripherals.ts`, `Web/studio/src/peripheralsPanel.ts`, `Web/studio/src/project.ts`, `Web/studio/src/inspector.ts`, `Web/studio/src/explorer.ts`, `Web/studio/src/main.ts`, `Web/studio/src/layout.ts`, `Web/studio/src/testPanel.ts`, `Web/studio/src/studio-components.css`

Devices now have a home in the editor. A Peripherals panel (a tab beside Explorer, also opened from the Explorer's Add menu as "Peripheral...") lists the devices a game uses as cards: iPhone, Apple Watch, AirPods, with an iPad "Coming soon" entry in the picker. Each card shows the signals the device gives (Position and gestures, Heart rate, Head direction) as checkboxes with an "In use" / "No script yet" status, and an "Add handler" button that creates a stubbed client script and attaches it to the selected entity (or to a new empty entity named after the device; the head signal needs a selected entity because `onLookAt` reaches only the entity being looked at). Motion gestures moved from the Inspector under their device. A notice offers to add devices when scripts use signals nothing provides. The scene gains `peripherals: ['phone' | 'watch' | 'airpods']` (default none) listing the devices; signals stay in `inputs` and `gestures`, devices shown are the listed ones plus those the signals imply, and the first declaration of `inputs` is seeded from what the scripts already use. The simulator rig (`rigFor`) takes the listed devices too. The Swift scene decoder ignores the new key, as it already ignores `inputs` and `gestures`.

Deviations from the staged plan:
- the panel refreshes on typing with a debounced full render (400 ms, skipped while focus is inside the panel) instead of a status-only refresh, so the missing-signals notice updates too
- `addHandlerScript` notifies `scene` when it creates an entity (the viewport listens only to that) and `scripts` otherwise
- the Inspector's `section` and `prop` helpers are exported for the panel
- Remove on a motion gesture and on a device returns focus to the Add peripheral button

Not verified in a browser: the picker sheet, card layout and spacing, focus after changes, the disabled Add handler state, the Explorer menu item, the Peripherals tab in the three layout presets.

Open: which devices receive `ctx.haptic` (the panel lists Haptic under iPhone only); built-in gestures sit under iPhone because the simulator emits them on the phone, though overview.md puts squeeze and pinch on the Watch; iPad, Apple Pencil and audio outputs are not built.

Stale comments flagged, not edited: `Web/packages/pear-runtime/src/scene.ts` line 1 ("Same shape ... as SceneDescription.swift"; `inputs`, `gestures` and `peripherals` are not in Swift), the doc above `rigFor` in `Web/studio/src/needs.ts`, the comment above the rig line in `Web/studio/src/run.ts` ("A game that declares its inputs ..."), the key list in the doc above `setSceneSetting` in `Web/studio/src/project.ts`.
- [x] `Web/packages/pear-runtime/src/scene.ts` — `PERIPHERAL_KINDS`, `parsePeripherals`, `SceneDescription.peripherals`.
- [x] `Web/studio/src/needs.ts` — `rigFor` takes the listed peripherals.
- [x] `Web/studio/src/run.ts` — rig from `scene.peripherals` too.
- [x] `Web/studio/src/peripherals.ts` — catalog and pure edits.
- [x] `Web/studio/src/peripheralsPanel.ts` — panel and picker.
- [x] `Web/studio/src/project.ts` — `applyPeripheralChange`, `addHandlerScript`, `peripherals` setting.
- [x] `Web/studio/src/inspector.ts` — Players section replaces Inputs and Motion gestures.
- [x] `Web/studio/src/explorer.ts` — `Peripheral...` in the top-level Add menu.
- [x] `Web/studio/src/main.ts` — panel registered, picker wired.
- [x] `Web/studio/src/layout.ts` — Peripherals tab in all presets.
- [x] `Web/studio/src/testPanel.ts` — note under the device list.
- [x] `Web/studio/src/studio-components.css` — panel styles.
- [x] `Web/studio/test/peripherals.test.ts` — catalog, edits, stubs in the real sandbox.
- [x] `Web/packages/pear-runtime/test/runtime.test.ts` — `parsePeripherals`.
- [x] `Web/studio/test/authoring.test.ts` — `applyPeripheralChange`, `addHandlerScript`.

### 2026-11-14 — Project delete and finding Peripherals
Paths: `Web/packages/pear-cloud/src/client.ts`, `Web/studio/src/account.ts`, `Web/studio/src/project.ts`, `Web/studio/src/recent.ts`, `Web/studio/src/projectsScreen.ts`, `Web/studio/src/main.ts`, `Web/studio/src/layout.ts`, `Web/studio/src/explorer.ts`, `Web/studio/src/peripherals.ts`, `Web/studio/src/peripheralsPanel.ts`

Projects can be deleted from the gallery. A cloud game you own gets Delete (confirm sheet; removes the game and its versions through the new backend route, then its preview and opened time; the editor unlinks it if it was open). The autosaved draft gets Discard (removes the stored draft; the editor keeps its project and saves a new draft on the next change). A project saved on this computer keeps Remove (forgets the entry; the web cannot delete a file). A game another account owns has no action. The confirm button closes the sheet first, so a failure shows on the page.

Peripherals are easier to find. A saved layout from before the panel existed is offered the Peripherals tab once, beside Explorer (`pear.studio.layout.offered` remembers it, so closing the tab sticks; the presets mark it offered). The Explorer has a Peripherals group between Scene and Client scripts: an Add button for the picker, an empty-state line, and a row per device that opens the panel. `readPeripheralState` moved to `peripherals.ts` so the panel and the Explorer share it.

Known, not changed: a draft or recent entry saved while linked to a deleted game keeps its `gameId`, so Publish from it reports the existing "no such game" message. A preview render still queued for a deleted game fails inside `ThumbnailQueue`, which already swallows errors.

Not verified in a browser: the Delete and Discard sheets and buttons, the Explorer group and arrow-key order, the one-time Peripherals tab in a saved layout.

Stale comments flagged, not edited: the first line of `Web/studio/src/explorer.ts` (lists entities and scripts only) and of `Web/studio/src/projectsScreen.ts` (tile actions named as Open).
- [x] `Web/packages/pear-cloud/src/client.ts` — `deleteGame`.
- [x] `Web/studio/src/account.ts` — `deleteGame`.
- [x] `Web/studio/src/project.ts` — `deleteDraft`.
- [x] `Web/studio/src/recent.ts` — `rowAction`.
- [x] `Web/studio/src/projectsScreen.ts` — Delete and Discard with confirm sheets, `deleted` hook.
- [x] `Web/studio/src/main.ts` — unlink on delete; Explorer callback.
- [x] `Web/studio/src/layout.ts` — `panelsToOffer`, one-time offer.
- [x] `Web/studio/src/explorer.ts` — Peripherals group.
- [x] `Web/studio/src/peripherals.ts` — `readPeripheralState`.
- [x] `Web/studio/src/peripheralsPanel.ts` — uses the shared reader.
- [x] `Web/studio/test/layout.test.ts` — `panelsToOffer`.
- [x] `Web/studio/test/screens.test.ts` — `rowAction`.
- [x] `Web/studio/test/studio.test.ts` — `AccountController.deleteGame`.
- [x] `Web/studio/test/peripherals.test.ts` — `readPeripheralState`.
- [x] `Web/packages/pear-cloud/test/client.test.ts` — `deleteGame`.

### 2026-11-14 — Simulator viewport and device ownership
Paths: `Web/packages/pear-runtime/src/scene.ts`, `Web/packages/pear-runtime/src/rig.ts`, `Web/packages/pear-runtime/src/viewport.ts`, `Web/packages/pear-runtime/src/index.ts`, `Web/packages/pear-sim/src/devices.ts`, `Web/studio/src/run.ts`, `Web/studio/src/peripherals.ts`, `Web/studio/src/peripheralsPanel.ts`, `Web/studio/src/project.ts`, `Web/studio/src/deviceMenu.ts`, `Web/studio/src/testPanel.ts`, `Web/studio/src/main.ts`, `Web/studio/src/theme.css`

The viewport is the Device Simulator of overview.md Module 4, not only a scene editor. It draws every simulated player (body, head, gaze ray, 15 degree look-at cone, the devices they carry, a ring after a haptic) and the trigger volumes (in the guides group, so gallery previews do not change). While stopped it shows one player at `playerOrigin` with the devices the game lists. While running the editor camera stays on (Overview, framed on everyone) with "Player view" as the first-person alternative. Clicking a player drives it, dragging it places it, a double click walks it there at 1.5 m/s, clicking a device opens its gestures or heart-rate presets, and "Add player" sits in the viewport.

Scene field `ownership` (`{ [kind]: { mode, at? } }`) says who holds each device kind: `player` (each player has their own, the default and not stored), `free` (one device in the room at `at`, default [0, 1, -2]; phone and watch only) or `passed` (one device, one holder at a time). In local Play a free or passed kind is one shared `SimDevices` (`RunController.rooms`, one per kind because position is per instance) and each player's own devices `redirect` to it: a free device's packets reach every player, a passed device's only its holder, and a passed device copies its holder's head look, position and heart rate every 20 ms. `holdDevice` hands it over; the old holder's copy goes stale through InputBus. Server and join runs ignore ownership (Output says so). The Peripherals card has a "Held by" selector; dragging a free device in the viewport saves its place once, on drop.

Known, not changed: a free device's events reach every client, so a script that fires a remote on it fires once per player (real routing would deliver it to the server once). A free phone puts a `hand` probe at its position for every player. A passed AirPods leaves other players with no head. Entity drag still pushes one undo step per pointer move. No script API hands a device over; `RunController.holdDevice` is the single entry a later one calls. Real routing for the Player app, the relay and the server is not built.

Not verified in a browser: avatar and device drawing, the device menu, camera modes, drag to place, double click to walk, dragging a free device.

Stale comments flagged, not edited: `Web/packages/pear-runtime/src/viewport.ts` line 1, `Web/packages/pear-runtime/src/scene.ts` line 2, the "Keys:" doc of `Project.setSceneSetting` in `Web/studio/src/project.ts`, and in `Web/studio/src/run.ts` the docs on `bindCamera` (a click is mouse-look and the camera follows the head), `rig`, `setRunning` and `applyPeripheralChange`'s device-field list in `Web/studio/src/project.ts`.
- [x] `Web/packages/pear-runtime/src/scene.ts` — `ownership`, `parseOwnership`, `ownershipOf`.
- [x] `Web/packages/pear-runtime/src/rig.ts` — `rigLayout`, `rigKey`, rig view types.
- [x] `Web/packages/pear-runtime/src/viewport.ts` — `setRig`, `pickRig`, `frameAll`, trigger volumes.
- [x] `Web/packages/pear-sim/src/devices.ts` — `idPrefix`, `redirect`, `heartRateBpm`.
- [x] `Web/studio/src/run.ts` — rooms, routing, `holdDevice`, overview camera, walk-to, `stepToward`, rig view.
- [x] `Web/studio/src/peripherals.ts` — `setOwnership`, `placeDevice`, `previewRig`.
- [x] `Web/studio/src/peripheralsPanel.ts` — "Held by".
- [x] `Web/studio/src/project.ts` — `ownership` in `applyPeripheralChange` and `setSceneSetting`.
- [x] `Web/studio/src/deviceMenu.ts` — `deviceMenuItems`.
- [x] `Web/studio/src/testPanel.ts` — Devices rows, `holdingText`.
- [x] `Web/studio/src/main.ts` — preview rig, device menu, drop of a free device.
- [x] `Web/packages/pear-runtime/test/rig.test.ts`, `Web/packages/pear-runtime/test/runtime.test.ts`, `Web/packages/pear-sim/test/sim.test.ts`, `Web/studio/test/peripherals.test.ts`, `Web/studio/test/authoring.test.ts`, `Web/studio/test/play.test.ts`, `Web/studio/test/testPanel.test.ts`.

### 2026-11-14 — Stale comments updated
Paths: `Web/packages/pear-runtime/src/viewport.ts`, `Web/packages/pear-runtime/src/scene.ts`, `Web/studio/src/project.ts`, `Web/studio/src/run.ts`

Comment text only, at the user's instruction; closes the "Stale comments flagged, not edited" list of the simulator entry above. `viewport.ts` line 1 now covers trigger volumes and the players and devices drawn from a `RigView`. `scene.ts` line 2 lists `ownership` and `raise` among the web-only fields. `project.ts` line 1 and the `setSceneSetting` and `applyPeripheralChange` docs name instructions and `ownership`. The `run.ts` `bindCamera` and `setRunning` docs now separate Player view (mouse-look, head-follow) from Overview (editor camera, click a player or device, drag to place). Checked and left alone: the `run.ts` `rig` docs and the `viewport.ts` `setHeadPose` doc.

### 2026-11-14 — Agent players in the run (Phase 12.3)
Paths: `Web/studio/src/run.ts`, `Web/studio/src/testPanel.ts`, `Web/studio/src/main.ts`, `Web/studio/src/marketplace/controller.ts`, `Web/studio/src/pauseClock.ts`, `Web/studio/src/agentPlayers.ts`, `Web/studio/src/agentTransport.ts`

Local Play can seat a Deep Agent in a player (Test panel: Agent, persona, instructions role). The run's clock is a pause clock injected into `LocalRun`, the room `SimDevices` and the in-page server, so time stands still while any agent thinks; walking, wandering and bots skip while held. Each player keeps a cue log and an observation of what a person would perceive. Not paused: the creator's own keyboard walk, which fires no events because `dt` is 0. `timeScale` does not scale agent pacing. Plan in `plan.md` Phase 12.3.
- [x] `Web/studio/src/run.ts` — `hold`, `release`, `held`, `gameTime`, `observationFor`, `setAgent`, agent actions, cues.
- [x] `Web/studio/src/testPanel.ts` — Agent toggle, persona and role selects, status line.
- [x] `Web/studio/src/main.ts` — `agentUrl`.
- [x] `Web/studio/src/marketplace/controller.ts` — `runtimeUrlOf`.
- [x] `Web/studio/test/agentRun.test.ts`, `Web/studio/test/agentPlayers.test.ts`

### 2026-11-15 — Playtest report (Phase 12.4)
Paths: `Web/studio/src/playtestReport.ts`, `Web/studio/src/playtestView.ts`, `Web/studio/src/agentPlayers.ts`, `Web/studio/src/run.ts`, `Web/studio/src/panels/deep-agent.ts`, `Web/studio/src/main.ts`, `Web/studio/src/testPanel.ts`

The Test panel's Finish playtest asks each agent player to look back once (the plugin's `report`, clock held), then builds a report: what was unclear, grouped by instructions phase with the same note from several players merged, each agent's summary, calls, and run problems (call limit, failed calls) kept apart. Stopping without the look back keeps a partial report from the notes so far; agents taken off a player keep their notes. Send to chat fills the Deep Agent prompt in Instructions mode and never sends.
- [x] `Web/studio/src/playtestReport.ts`, `Web/studio/src/playtestView.ts`
- [x] `Web/studio/src/agentPlayers.ts` — `kind` on notes, `lookBack`.
- [x] `Web/studio/src/run.ts` — `report`, `finishPlaytest`, retired agents.
- [x] `Web/studio/src/panels/deep-agent.ts`, `Web/studio/src/main.ts`, `Web/studio/src/testPanel.ts`
- [x] `Web/studio/test/playtestReport.test.ts`, `Web/studio/test/agentPlayers.test.ts`, `Web/studio/test/agentRun.test.ts`, `Web/studio/test/deep-agent.test.ts`

### 2026-11-15 — Instructions panel (Phase 12.5)
Paths: `Web/studio/src/instructionsPanel.ts`, `Web/studio/src/main.ts`, `Web/studio/test/instructions.test.ts`

A new Instructions panel (View > Game instructions, or Window) edits a game's written instructions directly, one undo step per field, cleaned by `parseInstructions`; shows the scene check (what `scene.json` disagrees with, the scene being the side out of sync); shows an agent's proposal as a list of changes with Accept and Reject; and shows the playtest report with Send to chat. It is not in the layout presets. A new proposal is announced, not shown automatically.
- [x] `Web/studio/src/instructionsPanel.ts`
- [x] `Web/studio/src/main.ts` — panel spec, menu item, announcement.
- [x] `Web/studio/test/instructions.test.ts` — helper cases.

### 2026-11-15 — Instructions first (Phase 12.6)
Paths: `Web/packages/pear-runtime/src/instructions.ts`, `Web/studio/src/newGame.ts`, `Web/studio/src/project.ts`, `Web/studio/src/instructionsPanel.ts`, `Web/studio/src/inspector.ts`, `Web/studio/src/run.ts`, `Web/studio/src/testPanel.ts`, `Web/studio/src/main.ts`, `Plugins/langchain-deepagents/runtime/instructions.py`

Instructions gain a lose condition (a missing win or lose is a lint warning). A new game starts from the New game form: title, summary, players, win, lose, roles. The player limit has one source (the instructions, else the scene's declared inputs) and every route that writes either keeps both equal; the Test panel, status bar, Inspector and Instructions panel show it the same way. Local Play starts with that many players and nobody driven (Drive and Stop driving are buttons); Seat agents fills every undriven player with an agent, optionally at Play start (off by default). The plugin is 0.7.43 because the older check refuses `lose`.
- [x] `Web/packages/pear-runtime/src/instructions.ts`, `Web/packages/pear-runtime/test/instructions.test.ts`
- [x] `Plugins/langchain-deepagents/runtime/instructions.py`, `Plugins/langchain-deepagents/runtime/players.py`, `Plugins/langchain-deepagents/pear-plugin.json`
- [x] `Web/studio/src/newGame.ts`, `Web/studio/src/projectsScreen.ts`, `Web/studio/src/main.ts`
- [x] `Web/studio/src/project.ts`, `Web/studio/src/inspector.ts`, `Web/studio/src/instructionsPanel.ts`
- [x] `Web/studio/src/run.ts`, `Web/studio/src/testPanel.ts`
- [x] `Web/studio/test/instructions.test.ts`, `Web/studio/test/newGame.test.ts`, `Web/studio/test/agentRun.test.ts`

### 2026-11-15 — Test view: status header, readable checklist, plain devices
Paths: `Web/studio/src/testPanel.ts`, `Web/studio/src/testStatus.ts`, `Web/studio/src/gamePanel.ts`, `Web/studio/src/main.ts`, `Web/studio/src/theme.css`

The Test panel opens with a header: the run state, one Play / Stop button, "Playtest with agents..." (now always shown, not only during a local run), a Speed select (the old Time scale section), and a collapsible readiness summary ("Ready to play" or "N things to fix" plus the game's declared needs). Readiness is one row per item with a state mark (done, needs fixing, optional), a label, a hint and the one-click fix. Server scripts and publishing are optional, and the last run's state moved to the header, so neither counts against readiness. `Check` gains optional `kind` (`run` / `publish`) and `optional`. The player count reads "N playing · allows A to B" in the panel and the status bar (one function, `playingText`). Players show what Play will do before it runs. Devices carry a subtitle (set by the game, or remembered in this browser), plain captions ("Held in hand · each player has their own"), no per-row "Stopped", a quiet Remove, and a sentence in place of the disabled Add device when all three devices are present. Section headings are bolder in this panel only. The panel remembers which marked control had focus across a rebuild, so Play becomes Stop without losing keyboard focus. Not unit-tested: the DOM (the helpers are, in `testStatus.test.ts`).
- [x] `Web/studio/src/testStatus.ts`, `Web/studio/test/testStatus.test.ts`
- [x] `Web/studio/src/gamePanel.ts`, `Web/studio/src/testPanel.ts`
- [x] `Web/studio/src/main.ts`, `Web/studio/src/theme.css`
