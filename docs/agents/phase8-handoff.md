# Phase 8 handoff: Omni Web Studio and live hosting

From: tienvu-lol laptop (Windows), manual session plus Opus orchestrator and Sonnet 5.5 workers, 2026-11-14.
Branch: `phase8/web-studio`. Spec: `.claude/plan.md` section `## Phase 8` (every checklist line, with divergence notes). Source of truth stays `.claude/overview.md`.
Read this file, then `.claude/plan.md` Phase 8, before you change anything.

## State

All Phase 8 checklist lines (8.1 to 8.6) are ticked `[x]`. Each one passed its lane's tests plus a Jev post-run gate.

| Area | Path | Verified by |
|---|---|---|
| Backend live integration (8.1) | `Backend/` | `cargo test` (lib, api, live, memstore_api, script_host) |
| Web SDK (8.2) | `Web/packages/omni-{core,runtime,script,sim,cloud}` | `npm test` (46 tests), `npm run typecheck` |
| Web Studio (8.3, 8.6 blank template) | `Web/studio/` | `npm test` (60 with the server e2e), build, headless page load |
| Desktop executable (8.4) | `Web/studio/src-tauri/` | `cargo check`, `npx tauri build` produced the NSIS installer |
| Hosting (8.5) | `Deploy/`, `.github/workflows/studio-release.yml` | `bash -n`; `dev.sh` reaches `/health` |
| Live demo (8.6) | `Deploy/demo.sh` | green against the local stack: 2 players, round `won` |

Decisions recorded in `plan.md`:
- Keep Tauri 2. The UI renders in the OS webview and ships as a native installer.
- Phase 6 (collaborative coding) is a stretch goal, deferred until Phase 8 is done.
- Phase 8 is numbered 8 so that existing 6/7 references stay valid.

## Run it

Needs cargo (`~/.cargo/bin` on PATH) and Node 22+. Docker and Postgres are not needed locally.

```bash
cd Web && npm install && cd ..
bash Deploy/dev.sh                     # backend :8080 (in-memory store, OMNI_DEV_SIGNIN=1) + Studio :5173
bash Deploy/demo.sh                    # in a second shell: scripted 2-player Flagship round, prints debug log + ctx.state
OMNI_E2E_URL=http://localhost:8080 npm --prefix Web test   # includes the server e2e
```

- Studio: http://localhost:5173. Sign in with any name (dev sign-in), open the Flagship or Blank template, then try Run local, Run on server, and the Debug tabs (Output, Server, State, Packets).
- Desktop installer (Windows): `cd Web/studio && npx tauri build` writes `src-tauri/target/release/bundle/nsis/Omni Studio_0.1.0_x64-setup.exe`. The macOS dmg must be built on a Mac or by the release workflow (tag `studio-v*`).
- Hosted (Vultr): `Deploy/vultr-bootstrap.sh` (see its header). Same env names as local: `DATABASE_URL`, `OMNI_DOMAIN`, `OMNI_DEV_SIGNIN`, `OMNI_STUDIO_DIR`, `OMNI_CORS_ORIGINS`, `PORT`.

## Open items (pick up here)

1. Studio review leftovers: fix round 1 (`a4bdd509`, gate 0.96) fixed:
   - UI scale in sheets and menus
   - panel collapse
   - keyboard split
   - focus kept across live updates
   - the Server tab "version none" bug
   - the desktop update check

   Review items 14, 18, 20, 22-25 and 27 are still open; ask the reviewer run `8c0c367f` output or redo the review. None of the round-1 fixes has been checked by eye.
   Not tested: two players in one session from the Studio; publishing a new version while a session runs; pop-out panels in a real window (and on macOS).
2. Swift `ServerScriptEngine.swift` has the same leading-comment `export default` bug that was fixed in `Backend/` (outside Phase 8 scope). It needs a Mac, per the Swift rules in `.agents/AGENTS.md`.
3. Not file-bound (plan 8.6): a demo on the real Vultr box from the desktop executable; two people on two machines in one server session.
4. FLAGGED for Tien:
   - overview.md describes Studio as native macOS only, so it does not cover the web/desktop Studio.
   - Stale "factory yields NoopHost" header comments in `session.rs` and `script_host.rs` were kept under the comment rule.
   - `?token=` in the URL needs TLS.
   - The sandbox uses `new Function`, so the Tauri CSP needs `unsafe-eval`.
   - Every `[provisional: needs-tien-review]` note in Phase 8 lines.
5. Human-only:
   - Create the Vultr instance and DNS record.
   - Paste `DATABASE_URL` (TigerData).
   - Code-signing certificates (installers are unsigned until secrets exist).
   - Store `~/.tauri/omni-studio.key` (on the tienvu-lol laptop) as the GitHub secret `TAURI_SIGNING_PRIVATE_KEY`. Never commit it.
   - `vultr-bootstrap.sh` fetches from `main`, so it works only after this branch is merged (and the repo is reachable from the box).
   - Docker, Caddy and Vultr files are written but have never been run.

## How local agents continue (same protocol as this run)

- Models: orchestrator `claude-opus-5-5`; workers and reviewers `claude-sonnet-5-5` (`.claude/instructions.md` Autonomous Mode).
- One writer per directory. Workers run no git, never edit `.claude/`, use no Docker, and write only inside their cwd. Each worker prompt states a concrete done condition.
- Jev hooks, in `Tools/jev-hooks/`. Each Jev call costs one System One request. Install `pi-jev` and set `TYPESAFE_API_KEY`.
  1. `bash Tools/jev-hooks/prespawn.sh <task-file>` must exit 0 before a launch. It checks that the task is scoped, that it forbids git and `.claude/`, and that it has a done condition.
  2. `bash Tools/jev-hooks/route.sh <task-file>` prints `{lane, thinking, split}`. Launch with model `claude-sonnet-5-5:<thinking>`. If `split` is true, launch one task per directory.
  3. Post-run gate: `postrun.sh <backend|web|studio|deploy|tauri>`. On Windows, call Git Bash by its full path (`"C:/Program Files/Git/usr/bin/bash.exe" .../postrun.sh <lane>`), because plain `bash` resolves to WSL and exits 127.
- Live monitor (Windows): `powershell -ExecutionPolicy Bypass -File Tools\watch-workflow.ps1`. It reads pi-subagents run files in `%TEMP%`.
- The pi orchestrator agent used here lives in user config, not in the repo: `~/.pi/agent/agents/orchestrator.md`. Its tools are `subagent` and `bg_wait`, and it may launch only `worker` or `reviewer`. Copy it if your laptop runs pi. Builtin `worker` agents cannot spawn subagents.
- Mac laptops: run the Swift checks (`.agents/scripts/verify-swift.sh`) before touching `Packages/` or `Apps/`. Phase 8 changed no Swift code.

## Checkpoint: branch, commits, PR

- Branch `phase8/web-studio`, based on `main` at `7233555` (the STOP commit; the overnight loops are stopped). The working tree is clean.
- Commits, one per lane:

  | Commit | Scope |
  |---|---|
  | `3771eb8` | Backend 8.1 |
  | `f2c19eb` | Web SDK 8.2 |
  | `26fdcc0` | Deploy 8.5 and `demo.sh` |
  | `8ce4876` | Tools: Jev hooks and monitor |
  | `e029765` | Studio 8.3, Tauri 8.4 and the blank template |
  | `d625192` | Plan, architecture and handoff |

- PR: not opened yet. Its body is drafted on the tienvu-lol laptop at `.git/PR_PHASE8.md`; once the PR exists, the PR description is the report. Merge by squash, following the repo rule.
- Before continuing on another laptop:

  ```bash
  git fetch origin && git switch phase8/web-studio
  ```

  Branch from it for new work, `agent/<laptop>/<slug>`, and open PRs against `phase8/web-studio` until it merges.

## Run record (2026-11-14, UTC-5)

The supervisor was Opus, in the manual session. The orchestrator was Opus (`863662d7`, custom pi agent). Every worker was Sonnet 5.5 and ran in its own directory.

| Run | Item | Attempts | Jev gate |
|---|---|---|---|
| `8b695ab1` | 8.1 backend integration | 1 | 0.89 |
| `1ba28ed8` | `memstore.rs` | 1 | 0.91 |
| `d0ec60fa` | 8.2 Web SDK | 1 | 0.98 |
| `c202bb17` | 8.5 Deploy, `demo.sh`, `download.html` | 1 | 0.87 |
| `ecbd1a1e` | 8.3 Studio and `blank.ts` | 1 | 0.95 |
| `6180e84a` | backend leading-comment fix | 1 | 0.89 |
| `b38fa630` | `demo.sh` workaround removed | 1 | 0.89 |
| `82d39c87` | `studio-release.yml` | 1 | YAML parses |
| `c85b15cb` then `3172c48f` | 8.4 Tauri | 1, revived after a question | 0.70, overridden |
| `ce50fe1a` | live UI verification | 1 | all steps pass |
| `8c0c367f` | brand-kit and accessibility review | 1 | 27+ findings |
| `a4bdd509` | Studio fix round 1 | 1 | 0.96 |

- No item needed a second attempt.
- Every in-run gate "failure" before the Git Bash fix was the WSL `bash` problem (exit 127). In each case the work itself was fine.
- Lost or wasted runs:
  - `c85eab6d`: an orchestrator launched as a builtin `worker`, which cannot spawn subagents. Replaced.
  - One parallel launch failed because its cwd `Web/` did not exist yet.
