## Phase 5: Demo Hardening

- [x] `Recordings/demo-fallback.usis.jsonl` — recorded full-play input session for the offline fallback demo. (Simulated, hand-written 60 s session against Games/Flagship/scene.json; replace with a real capture if one is recorded [provisional: needs-tien-review].)
- [x] `Apps/OmniStudio/OmniStudio/Mode/DemoMode.swift` — one-switch replay of the fallback recording through `UsisPlayer`. (Replays through a `ModeController.setInputOverride` input override; recording lookup order env `OMNI_DEMO_RECORDING` → bundle → `Recordings/` in cwd or bundle ancestors [provisional: needs-tien-review].) (Wired into AppModel and ModeToggleView Demo switch, #152; Sim/Live picker not disabled while Demo is on.)

Not file-bound: local hotspot setup, pre-paired devices, recorded fallback video, five clean demo runs in a row.
