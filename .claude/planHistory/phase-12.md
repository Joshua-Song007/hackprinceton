## Phase 12: Instructions and agent players

Not in overview.md; added at user request 2026-11-14 (overview.md stays unchanged until the user asks). Games are played in the real world, so a game carries written instructions (setup, roles, phases) and Studio can playtest them with simulated players driven by LangChain Deep Agents. Order is 12.1 to 12.5; local Play only (no server or join agent runners). Decisions: the instructions win over `scene.json` (lint flags the scene as out of sync); the simulation pauses while any agent is deciding; an agent sees only what a person would perceive; agents test the instructions and do not replace real players. Cloud saves keep the instructions in the version's `metadata.instructions` (no backend change). The Deep Agents plugin still runs in Studio only, never inside a running game (overview.md unchanged on that).

### 12.1 Instructions data

- [x] `Web/packages/pear-runtime/src/instructions.ts` — `Instructions` type (title, summary, players {min,max}, space, setup[], roles[{id,name,brief,kind}], devices {kind: own/free/passed}, phases[{id,title,text,steps[{role,do}]}], win), lenient `parseInstructions`, and `lintInstructions(instructions, scene)` warnings: player count vs `inputs.players`, gestures vs `inputs.gestures`, devices vs `ownership`, step role undeclared, phase without steps; the scene is the side flagged out of sync. Role `kind` is `player` or `ref` and sets `ctx.player.role`.
- [x] `Web/packages/pear-runtime/src/index.ts` — export instructions.
- [x] `Web/packages/pear-runtime/test/instructions.test.ts` — parse, bad input dropped not thrown, each lint code.
- [x] `Web/studio/src/project.ts` — `ProjectSnapshot.instructions?` (optional); `snapshot`, `load` and `setInstructions` (one undo step); `toVersion` writes `metadata.instructions`, `snapshotOfVersion` reads it; a pending proposal with accept and reject.
- [x] `Web/studio/src/projectFile.ts` — serialize and parse the optional `instructions` (validated by `parseInstructions`); `FILE_VERSION` unchanged, files without it still open.
- [x] `Web/studio/test/menu-save.test.ts` — round trip with instructions; an old file without the field; bad instructions refused with a sentence.
- [x] `Web/studio/test/instructions.test.ts` — project cases: `setInstructions` undo, snapshot and cloud metadata round trip, proposal accept, reject and load.

### 12.2 Plugin (Plugins/langchain-deepagents)

- [x] `Plugins/langchain-deepagents/runtime/translate.py` — forward `/instructions.json` writes and a successful `submit_instructions` as `file_written` (today only `/scripts/**` and `/scene.json` pass).
- [x] `Plugins/langchain-deepagents/tests/test_translate.py` — instructions.json forwarded; other paths still dropped.
- [x] `Plugins/langchain-deepagents/runtime/instructions.py` — prompts and schema check; modes `author` (plain text to instructions) and `revise` (current instructions plus a chat message to a full proposal). Prompts live in code, no new .md.
- [x] `Plugins/langchain-deepagents/runtime/players.py` — a deep agent per (run, player) thread; personas (follows rules, skims, cheats, confused); `decide` (instructions, role, persona, observation) returns actions plus `unsure` notes; `report`; filesystem tools denied (or a plain structured-output call if the deny form is unavailable).
- [x] `Plugins/langchain-deepagents/runtime/server.py` — `prepare_project` also writes `instructions.json`; `prompt` with `mode: 'instructions'`; `decide` to `plan` and `report` outside `PROJECT_LOCKS`; every reply keeps the id; per-run call cap on the server side.
- [x] `Plugins/langchain-deepagents/tests/test_instructions.py` — scripted model: author, revise, invalid output rejected.
- [x] `Plugins/langchain-deepagents/tests/test_players.py` — scripted model: valid actions, memory per player thread, persona applied, invalid action dropped, no file access.
- [x] `Plugins/langchain-deepagents/pear-plugin.json` — version 0.7.42 (a seed at the same version fails; `pyproject.toml` and `uv.lock` kept equal); permission `filesystem:project_instructions`.
- [x] `Web/studio/src/panels/deep-agent.ts` — send `instructions` in the project; mode selector (Scripts / Instructions); a `file_written` of `instructions.json` becomes a pending proposal, never applied directly, with Accept and Reject buttons until the 12.5 diff; an instructions run applies no script or scene write.
- [x] `Web/studio/test/deep-agent.test.ts` — proposal not applied until accepted; scripts and `scene.json` unchanged.

### 12.3 Agent players

- [x] `Web/packages/pear-runtime/src/observation.ts` — pure `buildObservation` from an `AvatarView` plus a cue list: own haptics, audio and speech cues heard, notes on actions that failed, devices in hand, game time, other players inside 8 m and in front (distance, bearing, gaze); no scene or server state, no phase (nothing in a run knows it). `Action` union (walk_to, look_at, gesture, give_device, say, wait) and `parseActions` (valid only, max 5, coordinates clamped to the arena, wait 0.5 to 10 s).
- [x] `Web/packages/pear-runtime/src/index.ts` — export observation (second change to this file).
- [x] `Web/packages/pear-runtime/test/observation.test.ts` — visible vs hidden, behind and out of range, bearing sign, invalid actions, clamps, and agreement with `players.py` (action names, gestures, limits).
- [x] `Web/studio/src/pauseClock.ts` — pure pausable clock: `now`, `epoch`, `setTimer`, `clearTimer`, `hold`, `release`, `reset`; time and timers stand still while held, holds nest.
- [x] `Web/studio/test/pauseClock.test.ts` — now frozen while held, timers fire after release with the remaining time, clear works, reset.
- [x] `Web/studio/src/run.ts` — `RunController.hold()`, `release()` and `held` (the pause clock goes into LocalRun, SimDevices and `createPlayServer`; wander and walk skip while held); per-player `agent` driver (instead of a `control` field: idle already means standing still); per-player cue log (speak, audio, haptic, notes); `observationFor(id)`; `setAgent` with error sentences; the agent's actions applied through the run. Local Play only. (`timeScale` alone cannot pause: it only scales `dt` in `LocalRun.step` and `walk`; agent pacing is on the unscaled pause clock.)
- [x] `Web/studio/src/agentTransport.ts` — socket to the Deep Agent runtime for `decide` and `report` (lazy, matched by id, timeouts, no auto-reconnect, URL read at each open).
- [x] `Web/studio/src/agentPlayers.ts` — a driver per agent player: decide every 1.5 s of game time; one action per tick (walk waits for arrival, wait counts clock seconds); `hold()` while a request is in flight; 20 s transport timeout and a 10 s backoff after an error; call cap per player (default 60); calls counter (no tokens are reported) and `unsure` notes kept for 12.4. The `report` call at the end of a run belongs to 12.4.
- [x] `Web/studio/src/marketplace/controller.ts` — `runtimeUrlOf(id)`: the runtime URLs of an installed plugin.
- [x] `Web/studio/src/main.ts` — `agentUrl` for the run controller.
- [x] `Web/studio/src/testPanel.ts` — per-player Agent toggle, persona select, instructions role select, status and calls line (Thinking, Acting, Waiting); hidden for the driven player and outside local Play; `structureKey` includes the seat.
- [x] `Web/studio/test/agentPlayers.test.ts` — fake transport and clock: held while thinking and released after (also on error), two agents, plan order, walk wait, backoff, cap, dispose mid-flight, invalid actions; pause in `LocalRun` and the in-page server.
- [x] `Web/studio/test/agentTransport.test.ts` — id matching, errors, close, timeout, reopen, URL per open.
- [x] `Web/studio/test/agentRun.test.ts` — `RunController` with stub deps: observation holds no hidden state, actions, `setAgent` sentences, hold and release.

### 12.4 Playtest report

- [x] `Web/studio/src/playtestReport.ts` — pure: `buildPlaytestReport` (unsure notes grouped by phase in the instructions' order, then unknown ids, then no phase; the same note from several players merged; notes about the run kept apart as problems), `playtestPrompt` (revise prompt, cut to 4000 characters by whole items), `playtestLines` (the view's text) and `sendReport`.
- [x] `Web/studio/src/playtestView.ts` — renders the report (summary, player rows, notes by phase, run problems) with "Send to chat".
- [x] `Web/studio/src/agentPlayers.ts` — `AgentNoteRecord.kind` ('unsure' or 'run'), `lookBack()` (one `report` call holding the clock, notes at the last game time, summary kept, then the driver stops), clock holds kept in a set.
- [x] `Web/studio/src/run.ts` — `report`, `finishing`, `finishPlaytest()` (sentences when it cannot run); `stop()` keeps a partial report from live and retired agents; agents taken off a player are retired with their notes; `begin` clears the report.
- [x] `Web/studio/src/panels/deep-agent.ts` — `ChatLink` and `createChatLink()`: fills the prompt in Instructions mode, never sends.
- [x] `Web/studio/src/main.ts` — the chat link, `sendToChat`.
- [x] `Web/studio/src/testPanel.ts` — Playtest group: Finish playtest button and the report (also after the run stopped).
- [x] `Web/studio/test/playtestReport.test.ts` — grouping, merge, run problems, empty run, prompt and cap, lines, `sendReport`. The view is not unit-tested (node environment, no DOM).
- [x] `Web/studio/test/agentPlayers.test.ts`, `Web/studio/test/agentRun.test.ts`, `Web/studio/test/deep-agent.test.ts` — look back, finish and stop, retired agents, chat link.

### 12.5 Panel

- [x] `Web/studio/src/instructionsPanel.ts` — the Instructions panel: edit form (title, summary, space, players, setup, gestures, device modes, roles, phases with steps, win; each commit one undo step through `parseInstructions`), scene check (lint messages; the scene is the side flagged), proposal diff with Accept and Reject, playtest report with Send to chat; pure helpers for the tests (`editInstructions`, add and remove roles and phases, steps text, `instructionsDiff`, `lintMessages`). Not in the layout presets: opened from View > Game instructions or Window.
- [x] `Web/studio/src/main.ts` — registers the panel, View menu item, announces a new proposal.
- [x] `Web/studio/test/instructions.test.ts` — helper cases added to the existing file: edits cleaned by the parse, add and remove with limits, steps text round trip, diff of each kind of change, lint messages. The panel's DOM is not unit-tested (node environment, no DOM).

Not planned: server or join agent runners; a how-to-play screen in the Player app; published games carrying instructions beyond `metadata` (Phase 11 backend items).
