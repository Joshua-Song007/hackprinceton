# Autonomous Agent Rules

Applies to agents launched via `.agents/scripts/run.sh` and their subagents. Where these rules conflict with `.claude/instructions.md`, these win (git, `currentDev.md`, `stage`/`apply`). Manual sessions never read this file.

## Read first (read-only, never edit)
- `.claude/overview.md` — design source of truth.
- `.claude/PLAN.md` — the spec for your task. One checklist item = one file.
- `.claude/ARCHITECTURE.md` — layering rules and forbidden dependency edges.

## Scope
- Do only the task in your prompt (usually specific `PLAN.md` item numbers). No drive-by refactors, no unrelated files. Other agents are working in parallel worktrees.
- MVP only. Never build Post-MVP backlog items.
- Never write to `.claude/`, `.agents/`, `.github/`, or legacy `core/` and `api/`. Do not tick `PLAN.md` boxes or touch `currentDev.md`; the human does that on merge.
- No new `.md` files. No new dependencies: use the pins in the root `Cargo.toml`. If a task needs a new dependency, stop and say so.
- If the plan contradicts `overview.md` or `ARCHITECTURE.md`, or a requirement is ambiguous, stop and report it. Do not guess.

## Code
- Preserve all existing comments exactly. Keep comments in place when rewriting code.
- Layer 2 domain crates are pure: no IO, async, DB, clock, or global RNG. Time and randomness enter as arguments.
- Unit tests live inline (`#[cfg(test)]`) in the file they cover. Non-trivial logic ships with tests.
- Respect the dependency graph and forbidden edges in `ARCHITECTURE.md`.

## Git
- You work in your own worktree on branch `agent/<slug>`. Commit there freely, in small commits.
- Push only your own branch: `git push origin agent/<slug>`. Then open a PR with `gh pr create`.
- Never push to `main`. No force-push, rebase, reset, or checkout of other branches.
- PR body: never put a line starting with `#` inside the `gh pr create --body "..."` command. The permission check denies it. Use bold labels (`**Completed**`) instead of Markdown headings. The body can still be multi-line.

## Tools and denied commands
- Read, search and list files with the Read, Grep and Glob tools, not shell text tools (`cat`, `wc`, `head`, `find`). The shell allow-list is narrow on purpose.
- A denied command is not a broken shell. Other allowed commands (`.agents/scripts/*`, `cargo`, `git`, `gh pr create`) still work. Try another tool. If the task truly can't proceed, report the exact denied command in your final message and continue with whatever you can still do.
- Run scripts by relative path from the repo root, exactly `.agents/scripts/verify-rust.sh`. The allow-list matches the relative form only: an absolute path or `cd ... && ...` is denied. Also denied: heredocs that write files (use Write/Edit), brace expansion. When you brief a subagent, tell it to use the relative form too.
- Before assuming work is already done, check the checklist item's file contents against `PLAN.md` and run the verify script. Do not stop on the assumption.

## Subagents
- `reviewer` (read-only): before opening a PR, run it on your branch. Fix every BLOCKING finding, run it again, and paste its final verdict line in the PR description. If you disagree with a finding, say why in the PR instead of ignoring it.
- `ios-reviewer` (read-only): the same duty as `reviewer`, but for any branch that touches `ios/`. Use it instead of `reviewer` there (use both if you touched Rust and iOS).
- `rust-crate-worker`, `ios-worker`: delegate to them only for large multi-item tasks. For a single checklist item, do the work yourself.

## Done means verified
- Run `.agents/scripts/verify-rust.sh` (and `.agents/scripts/verify-ios.sh` if you touched `ios/`) and see it pass. Do not claim success without running it. A stop-hook enforces this.
- If a check fails and you cannot fix it, say so with the failing output. Never report success on a red check.

## Report (final message and PR description)
- `PLAN.md` items completed.
- Items not completed, and why.
- Any simplification or divergence from `overview.md` — write the parenthetical note a human should append to that `PLAN.md` line.
- Verification commands run and their result.
 

## iOS (applies when you touch `ios/`)
- Your task comes from the iOS section of `.claude/PLAN.md` (read-only). Work only in `ios/`. Design reference: `ios/DesignRefs/<screen>.png` (onboarding, map, recording, recording-paused, summary; Figma exports at 3x, same size as the screenshots), plus existing assets. Figma itself is not available to you. The refs include design chrome (9:41 status bar, rounded corners) and placeholder numbers: ignore those. The `recording` screenshot is paused, so compare it with `recording-paused.png`.
- `ios/HexGame.xcodeproj` and `ios/Config/*.plist` are generated. Change targets, Info keys, entitlements and file membership only in `ios/project.yml`. Never edit the generated files and never run `xcodegen` yourself: `.agents/scripts/verify-ios.sh` runs it in a temp copy.
- Swift 6 strict concurrency: views and view models are `@MainActor`; anything crossing actors is `Sendable`. No `@unchecked Sendable` or `nonisolated(unsafe)` without a comment saying why.
- Colors and fonts come from `Theme.swift` tokens. No new `Color(hex:)`, raw hex or `.font(.system/.custom)` outside `Theme.swift`. If a token is missing, add it to `Theme.swift` and say so in the PR.
- No force unwraps (`!`), `try!` or `as!`. Use `guard`, `if let` or a typed default.
- New interactive controls and meaningful images get an `accessibilityLabel`; hide decorative images from accessibility.
- `Theme.swift` and `RunActivity.swift` are also compiled into the widget target: they must not reference app-only types. A new file the widget needs must be added to the `HexGameWidgets` sources in `project.yml`.
- New logic ships with Swift Testing tests in `ios/HexGameTests` (`@Test`, `#expect`). Logic lives in plain types that tests can call without UI. A UI-only change needs no unit test.
- Look at your UI: `.agents/scripts/screenshot-ios.sh <onboarding|map|recording|summary>` writes `ios/.screenshots/<screen>.png` (about 35 s); view it with the Read tool and compare it with the reference. Sheets and mid-onboarding steps cannot be captured: say so in your report instead of guessing. Never commit `ios/.screenshots`.
- Run `.agents/scripts/verify-ios.sh` (build and tests, about 45 s) until it passes. Do not start several simulators yourself: the script owns the `hexgame-verify` device.
- Report the screens you captured and what you compared; list anything you could not verify visually.
