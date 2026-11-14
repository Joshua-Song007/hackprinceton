# Studio guide

## Screens

1. **Login**: your name and Sign in. Required; there is no editor until you are signed in. The server address is under **Server: ...** below the form (it opens Settings).
2. **Projects**: one list of your projects, newest first: cloud games, projects saved or opened on this computer (last 10) and your autosaved draft. **New project** starts one from a template (Blank, Hot potato, Flagship) or creates an empty cloud game. **Open file...** sits under the list. File > Projects... returns here; Back to editor keeps your open project.
3. **Editor**: everything below. File > Sign out returns to Login.

## Toolbar

**Play** (F5), a menu next to it (Play locally, Play on server, Add test player in a new tab), **Stop** (Shift+F5), the project name (its menu: templates, open from cloud, save), and **Publish**.

## Menu bar

| Menu | Items |
|---|---|
| File | Projects..., New game..., Open template, Open from cloud, Open file (Ctrl+O), Save (Ctrl+S), Save as (Ctrl+Shift+S), Publish, Account and games, Settings (server URL, theme, scale), Sign out |
| Edit | Undo (Ctrl+Z), Redo (Ctrl+Shift+Z or Ctrl+Y), Delete selected entity |
| View | Frame selected (F), Reset camera, layouts (default, script focus, debug focus), Reset layout |
| Window | Show or hide panels, layouts, Save layout as, Reset layout |
| Run | Play locally (F5), Play on server, Stop (Shift+F5), Add player, Add test player |
| Help | API reference, Viewport controls |

Undo covers scene edits and script edits (script typing merges into one step per half second; 50 steps kept).

## Panels

| Panel | What it does |
|---|---|
| Explorer | Entity tree and the client / server script lists. Add entity (box, sphere, trigger zone, empty), rename (F2), duplicate (Ctrl+D), delete (Delete), context menu (Shift+F10). |
| Viewport | The 3D scene. See [viewport-and-camera.md](viewport-and-camera.md). |
| Inspector | Selected entity: name, position, rotation (degrees), scale, shape, colour, components, "New script...". With nothing selected: scene settings (name, run mode, tier, player origin, location permission). |
| Script editor | CodeMirror editor, one tab per script, error markers, autocomplete and hover docs. |
| Output | Client `console.log` and errors. |
| Server | Server `console.log`, errors, events in and out, joins and leaves. |
| State | Live `ctx.state` as a tree. Read-only: the server owns it. |
| Packets | USIS packets from the (simulated) devices, with `source`. |
| Test | Everything about a test run in one place: what the game still needs (checklist; each gap has a one-click fix, such as declaring a used input or adding a missing device), every player with position, last event received and a haptic dot, **Drive** (your keyboard and mouse control that player), **Wander**, **Remove** and **Add player**; a top-down map (click a player to drive it, drag to place it without switching); controls for the driven player (gesture buttons, what each gesture does in your scripts, head sliders, heart rate); and the devices every player has (**Add device** / Remove, remembered in this browser). |

## Declared inputs

With nothing selected, the Inspector shows scene settings, including **Inputs**: head, position, heart rate, the five gestures and min and max players (1 to 32). **Declare from scripts** fills them from your client scripts. Play uses them to pick devices and the starting player count.

## Layout

Every panel docks, tabs, resizes, collapses and (desktop) pops out. Keyboard: **F6 / Shift+F6** move between panels, **Ctrl+Alt+arrows** move a panel, **Alt+PgUp / PgDn** switch tabs, **Ctrl+Alt+M** maximize, **Ctrl+Alt+C** collapse. Layouts are saved automatically and presets are in the View menu.

## Settings

UI scale (90 to 200%), editor font size, theme (dark, light, high contrast), reduced motion, server URL.

## Files

Save writes a `*.omni.json` file (scene plus all scripts). The browser keeps an autosaved recovery copy, but a file is the durable copy.
