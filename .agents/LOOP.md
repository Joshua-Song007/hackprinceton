# Autonomous Loop

How the four laptops run Omni's agents unattended, bottom to top. Rules come from `.agents/agent-playbook.md` (the Anthropic agent playbook; rule IDs such as `DOD-08` refer to it and its Source Table lists the 45 original sources); only rules that fit this repo are adopted. Read with `.agents/AGENTS.md` (every agent) and `.agents/ORCHESTRATOR.md` (the per-laptop cycle). `overview.md` stays the source of truth.

## Start it
One command per laptop, from the clone's root folder:

```bash
.agents/scripts/start.sh <laptop-name>                # orchestrator loop
.agents/scripts/start.sh <laptop-name> --integrator   # the tooling integrator loop, started after it
```

`start.sh` installs what is missing (`setup.sh`), runs the checks, and starts the loop so it outlives the session: on a Mac in a detached `tmux` session (`omni-loop`, `omni-integrator`) under `caffeinate -i`, on Windows in its own Git Bash window with a hidden helper that keeps the PC awake while the loop runs. `--dry-run` prints the steps. What only a human can do: the `gh` and `claude` logins, Xcode 16+ from the App Store, and keeping a laptop on power with the lid open (caffeinate stops idle sleep, not lid sleep). The commands it runs underneath are `loop.sh` (`OMNI_ROLE=orch|integrator`). `loop.sh` first checks `jq`, that `claude` is installed and logged in (a one-cent Haiku call), the `gh` login, write access to the repo and the orchestrator settings file, and refuses to start until the human fixes whatever it reports. Nothing else is typed after that. The loop runs until a file named `STOP` or `STOP-<laptop>` exists on `origin/main`. Only Tien creates it.

## Layers, bottom to top

| Layer | What | Enforced by |
|---|---|---|
| 0. Guardrails | Allow/deny lists, `.claude/` human-only (read yes, write never), workers push only their own `agent/*` branch and never use `gh`, orchestrators have full `gh` and push rights (including `main` and force, used only as in `ORCHESTRATOR.md` Permissions), `HUMAN.md` hidden, CI on every PR | `settings*.json`, sparse-checkout, `verify.yml` (SEC-05, CFG-01: deterministic, not prompts) |
| 1. Worker | One headless Sonnet per task, own worktree, one `plan.md` item = one file, builds, tests, runs the reviewer, commits and pushes its own branch; self-reviews again when the orchestrator asks | `run.sh`, `stop-gate.sh` (cannot finish while `verify-swift.sh` (Mac) or `verify-nonswift.sh` fails), `--max-turns 60`, `--max-budget-usd 5` |
| 2. Reviewer | Read-only Sonnet subagent in a fresh context; reports BLOCKING / NON-BLOCKING and an APPROVE or CHANGES NEEDED line | `agents.json` (VER-05, REV-01) |
| 3. Laptop orchestrator | Opus, one cycle per run: triage PRs, pick unblocked items, launch up to 4 workers, open PRs, review each diff against the issue's acceptance criteria and verify the PR head itself (`verify-pr.sh`), run `review-pr.sh`, merge its own PRs, verify Windows laptops' Swift changes (Macs only), post status | `ORCHESTRATOR.md`, `settings.orch.json` |
| 3b. Integrator | Opus with a big budget while it builds PR, worktree and CI tooling (`prs.sh`, `worktrees.sh`, `health.sh`, `selftest.sh`, `hygiene.yml`), then Sonnet with a small one while it maintains them from the orchestrators' `tooling` issues, `[permission]` / `[ci]` / `[loop]` issues and failing runs. Edits only scripts, workflows, README and notes | `INTEGRATOR.md`, `settings.integrator.json`, `loop.sh` with `OMNI_ROLE=integrator` |
| 4. Cross-laptop | Laptops never message each other. Shared state is GitHub Issues, PRs and labels. Package ownership is static, so there are no claims to race on | ARCH-11 |
| 5. Loop | Backoff, STOP, a failure issue after 5 bad cycles, a local notification | `loop.sh` |
| 6. Tien | `STOP`, `DECISION:` comments, `human-hold`, `needs-tien`; the only role that edits anything in `.claude/` | |

Models: orchestrator `claude-opus-5-5`, workers and all subagents `claude-sonnet-5-5` (ORCH-17: keep judgment on the stronger model, volume on the cheaper one).

## Platforms: two Macs, two Windows laptops
- Swift only builds on macOS, so Windows laptops never create or edit Swift (`run.sh` denies those Edit paths whenever `uname -s` is not `Darwin`; `stop-gate.sh` skips Swift checks there). They run the non-Swift lane, checked by `verify-nonswift.sh` (JSON / JSONL validity, JS syntax) and, for the Rust backend, `verify-backend.sh` (`cargo build` + `cargo test`, on any OS).
- If Swift or `Schema/usis.schema.json` changes from a Windows laptop anyway, the PR gets `needs-mac-verify` and cannot merge until a Mac orchestrator has run `verify-pr.sh <n>` (which runs `verify-swift.sh` on the exact head commit in a throwaway worktree) and commented `MAC-VERIFIED <sha>`. With that comment the PR's own laptop may merge it, and a Mac orchestrator may merge it if the owner has not. `review-pr.sh` flags a missing comment; the macOS CI job runs on every PR as well.
- No containers: every agent works in the directory it was given (worktrees next to the clone). Keep the clone out of OneDrive and similar synced folders.

## One unit of work
1. Orchestrator picks an unblocked item and writes a delegation brief (ORCH-01, T6): objective, files, allowed dependencies, done = `verify-swift.sh` (Mac) or `verify-nonswift.sh` green plus reviewer APPROVE, boundaries.
2. Worker builds, tests, reviews, commits, pushes its branch. Report format is fixed in `AGENTS.md`.
3. Orchestrator confirms the push (pushes itself only if the worker did not), opens the PR, runs `review-pr.sh`, posts the output as a comment.
4. Flags or CHANGES NEEDED: the worker is relaunched on the same branch with the findings. Maximum 3 rounds (REV-08); after that the issue gets `needs-human` and the dead ends are written in an issue comment (HAR-06, kept per issue so parallel agents never share a file).
5. Green, 0 flags, APPROVE: the orchestrator merges its own PR (squash), closes the issue with `done`, and adds the `plan.md` tick and any divergence note to the `Plan sync` issue. `.claude/` is human-only: no agent ever edits it, so Tien applies the ticks.

## Discrepancies: when the user is told, and how
Rows are raised as GitHub issues. The orchestrator's issues mention `@tienvu-lol`; the two that `loop.sh` opens itself (`[permission]` and `[loop]`) carry the `needs-human` label and an `@tienvu-lol` mention in the body. GitHub notifies by email and mobile only if Tien watches the repo. Mac laptops also show a local banner from `loop.sh`; Windows laptops only print a `NOTIFY:` line in `loop.out`. The agent keeps working on something else (smallest reversible default marked `[provisional: needs-tien-review]`).

| Situation | Issue title | Body must contain |
|---|---|---|
| A command was denied by `dontAsk` | `[permission] <command>` | The exact denied command and the exact `settings*.json` line that would allow it |
| Plan contradicts `overview.md` or `architecture.md` | `[contract] ...` + `contract-change`, `needs-tien` | Both quotes and the smallest default taken |
| A PR conflicts with `main` or another laptop's PR and the fix is not mechanical | `[conflict] #<a> vs #<b>: <files>` + `conflict`, mentioning the other owner | Both PR links, the hunks, what each side intends, a proposed resolution; the other orchestrator answers with a `RESOLUTION:` comment (ORCHESTRATOR.md step 2d) |
| Needs a new third-party dependency | `[dependency] <name>` + `needs-tien` | Why, which package, alternatives |
| Same failure 3 times | `[stuck] <item>` + `needs-human` | What was tried, evidence (DOD-12: next step is a bigger model or a human) |
| An agent cannot run 5 cycles | `[loop] <laptop> orch failing` or `[loop] <laptop> integrator failing` (by `loop.sh`) | Path of the last result JSON |
| CI infrastructure red on `main` | `[ci] ...` + `needs-human` | Failing job link |
| Budget or turn cap hit | status comment, not an issue | Which cap, which item; a repeat of the same item becomes `[stuck]` |

## Playbook rules: adopted, adapted, rejected
Verified here means checked against the installed CLI (2.1.322) or the Claude Code docs this session. Everything else from the playbook is the playbook's claim.

| Rule | Decision |
|---|---|
| ARCH-01/02/05: simplest workflow first; parallelize only along verifiable seams | **Adopted.** Our seam is the package: one owner, disjoint files, `verify-swift.sh` as the grader |
| ARCH-11: coordinate through git and a shared store | **Adopted** as git + GitHub Issues/PRs. A SQL task table is rejected (overkill for 4 laptops) |
| ORCH-01/02/05/07: delegation brief, effort scaling, no delegating same-file work, few specialist agents | **Adopted.** Two subagents only; max 4 workers; never two workers in one package |
| ORCH-09/CTX-13: return references and short summaries, keep noisy output out | **Adopted.** Reports are short; `stop-gate.sh` shows the last 40 lines only |
| DOD-02/07: done is a runnable check, enforced by a Stop hook | **Adopted and verified.** Stop hook exit 2 feeds stderr back to the agent |
| DOD-08: harness cap of 8 consecutive Stop blocks | **Verified** in the hooks docs, resets on a tool call; `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises it. Our own counter stops at 5, so it trips first |
| DOD-09: `--max-turns`, `--max-budget-usd` | **Adopted and verified** (print mode). Turns default 60, override `AGENT_TURNS` |
| DOD-11: do not prompt "keep going" | **Adopted.** The loop re-enters through cycles, never through nagging |
| DOD-12: escalation ladder (check, effort, bigger model, human) | **Adapted:** 3 failures then `needs-human`; effort and model changes are a human call for now |
| VER-02/05: evidence, separate judge | **Adopted.** Reviewer is a different context from the worker; same model family, which is weaker than the playbook's ideal |
| VER-03: near-perfect verifier | **Partly met.** Only OmniCore has tests today; the grader improves as tests land. Watch for green-but-wrong |
| REV-03/04/05/08: review against the spec, skip style, tag findings, 3-round cap | **Adopted** in the reviewer prompt and the round cap |
| REV-10/11: risk tiers, agent approval never fills a human slot | **Adapted, provisional.** Auto-merge is allowed (Tien's call), except PRs touching `Package.swift` dependency edges, `Schema/usis.schema.json`, `.github/`, or any `.xcodeproj`: those get `human-hold` and wait |
| SEC-01/05: deterministic boundaries, deny rules not prompts | **Adopted** |
| SEC-02/03: sandbox/VM, credentials outside | **Not met.** Laptops, real `gh` tokens. See limits |
| SEC-15: protect `main` | **Not verified** (see limits) |
| HAR-01/02: initializer plus JSON feature list | **Rejected.** `plan.md` already is the feature list; agents cannot edit it at all, which is stronger than "change only `passes`" |
| HAR-05: standard session start routine | **Adopted** in `AGENTS.md` (read spec, check item against `plan.md`, run verify) |
| HAR-13: worktree per task | **Adopted** (`run.sh`) |
| CTX-05: `CLAUDE.md` under 200 lines | **Violated**, see limits |
| ARCH-04/10, ORCH-12/13, SEC-14: 100-1000 agent systems | **Rejected** at this scale |
| COST-02/04: cache, medium effort default | **Adopted** by default (no effort flag set); one model per role keeps the cache warm |
| C10: risky changes end at a PR plus evidence | **Adopted** through the REV-10 tiers above |

## When a laptop runs out of credits
Nothing stalls on one laptop. The chain, from the failing loop up the hierarchy:
1. **Detect.** `loop.sh` recognizes credit, usage-limit and rate-limit errors in the cycle result (not a bug, so no `[loop]` issue). After two in a row it posts `OUT laptop=<l> role=<r> t=<epoch> reason=...` (with an `@tienvu-lol` mention) on the issue titled `Loop capacity`; posting uses `gh`, so it works with no credits. It then waits `CREDIT_WAIT` (default 1800 s, 3600 s after four) and keeps trying. On its first good cycle it posts `BACK ...`.
2. **Spread the lane.** Every healthy orchestrator reads that issue (ORCHESTRATOR.md step 1c) and applies the same rule: the OUT laptop's unblocked items, in `plan.md` order, go round-robin to the healthy laptops sorted by name (Macs only for Swift work). The same rule assigns the OUT laptop's open PRs for review and merge. No messaging is needed and the claim labels prevent double work.
3. **Keep the tooling layer.** If the integrator's laptop is OUT (or silent for 3 h while `tooling`, `[ci]` or `flaky` issues are open), the first healthy Mac's orchestrator starts a maintain-mode integrator with `start.sh <laptop> --integrator --maintain`.
4. **Human at the top.** The `@tienvu-lol` mention on `OUT` and the `needs-human` / `needs-tien` labels remain the escalation for anything the chain cannot absorb.
Limits: Swift work can only move between the two Macs, so if one Mac is OUT the other carries the whole Swift lane; if both are OUT, only non-Swift work continues. A returning laptop resumes its lane; a duplicate maintain-mode integrator is harmless. All of this is untested live: the credit-error wording is a regex guess (`usage limit`, `limit reached`, `credit balance`, `rate limit`, `quota`).

## Goal and done
The goal per laptop: every `plan.md` item of its lane in phases 1 to 5 merged with CI green, and no open PR of its own. The orchestrator ends each cycle with `STATUS: worked|idle|blocked|done`. `loop.sh` sleeps `IDLE_DELAY` (default 1800 s) on idle and blocked, and exits with a notification on done.

## Which file to point a Claude at
| Situation | Prompt | Reads |
|---|---|---|
| Start or restart the loop on a laptop (manual Claude session) | "follow .agents/BOOTSTRAP.md" | `BOOTSTRAP.md`, then the files it names |
| A laptop looks stuck or wrong | "read .agents/LOOP.md and the Debugging section of .agents/ORCHESTRATOR.md, then check the logs in ../omni.worktrees/logs" | `LOOP.md`, `ORCHESTRATOR.md`, the logs |
| Change a rule or a permission | edit `AGENTS.md`, `ORCHESTRATOR.md` or `settings*.json`, run `check-docs.sh`, push | the file itself |
| Set tonight's goals and limits | create or edit the issue titled `Mission` (template below) | GitHub only; every orchestrator reads it each cycle |
| Steer a running agent | a `DECISION:` comment on its issue, or the `human-hold` label | GitHub only |
| Stop | add `STOP` or `STOP-<laptop>` to `main` | nothing |
Agents themselves are never pointed at anything by hand: `run.sh` appends `AGENTS.md` (and `ORCHESTRATOR.md` for the orchestrator) to their system prompt.

## Mission issue template
One open issue titled `Mission`, written by a listed handle. Orchestrators read it every cycle (ORCHESTRATOR.md step 1a). Edit it to change course; add `DECISION:` comments for one-off rulings.
```
**Goal tonight:** <what "done" means, e.g. all Phase 1.5 OmniRuntime items merged with CI green>
**Priority order:** <plan.md items or sections, first to last; per laptop if they differ>
**Do not touch:** <paths, items, or packages that stay off limits tonight>
**Merge policy:** <auto-merge as ORCHESTRATOR.md says | open PRs only, nobody merges | merge only: <items>>
**Stop and escalate if:** <e.g. main red twice in a row, three needs-human issues, anything touching Package.swift edges>
**Notes agents cannot read from the repo:** <decisions made outside GitHub>
```

## How to prompt the loop
The orchestrator's launch prompt is fixed (`Run one orchestrator cycle.`). Do not customize it. Steer with GitHub, not chat:

1. **Write issues as three parts** (DOD-05): what is needed, what done looks like as a command that returns pass/fail, how to prove it. One `plan.md` item per issue, one file per item.
2. **Name boundaries.** Say which package, which files, which dependencies are allowed, and what not to touch. Vague tasks produced duplicated work and gaps in the playbook's own tests (ORCH-01).
3. **Decide with `DECISION:` comments.** A comment starting with `DECISION:` from a listed handle overrides everything else on that issue.
4. **Hold with `human-hold`.** Anything you want to read first gets the label; the orchestrators will not touch it.
5. **Freeze the spec between batches.** Edit `overview.md` and `plan.md` while no PRs are in flight, or agent PRs go stale.
6. **Never tell agents to "keep going" or "don't stop".** They re-enter by cycle. If a worker stops early, fix the check, not the tone.
7. **Start small.** First run: one laptop, one worker, 20 minutes, read the whole transcript (VER-15). Then add the rest. Tune the reviewer by reading its logs.
8. **Answer `needs-tien` issues first thing.** Everything blocked on them is waiting; the agents are working around it with provisional defaults, which pile up.
9. **Keep each laptop to its own packages.** Do not run a worker by hand in a package another laptop owns.
10. **Stop with a file, not with Ctrl-C.** Add `STOP` on `main` (web UI works from a phone); loops exit at the next cycle, workers in flight finish their task.

## Limits
- The playbook's numbers (token multiples, percentages, 1,000-agent results) are its own claims; the repo copy `.agents/agent-playbook.md` is the reference. Checked here: CLI flags, Stop-hook behavior, the `claude -p` JSON fields, and the allow/deny rules in `settings.orch.json` (real `claude -p` runs: workers may push `agent/*` branches, including names like `agent/x/domain-types`, and are denied `main`, `HEAD:main`, `--force`, remote deletes and every `gh` command; the orchestrator is allowed `git push*` and `gh *` except `gh repo delete`, `gh secret`, `gh ssh-key` and `gh gpg-key`).
- Tested on Windows only: `bash -n` on every script, `stop-gate.sh` dependency closure on a synthetic repo (a change in OmniOutput re-tests OmniOutput, OmniSim, OmniBridge; OmniCore re-tests all; `.build/` changes re-test nothing), worktree-root derivation from a worktree, a real Windows worker run (committed on its branch, the `.swift` write was denied, `HUMAN.md` hidden after the sparse-checkout fix), `review-pr.sh` against merged PR #1, `verify-swift.sh` and `verify-nonswift.sh` in CI. Mac validation runs: the first (commit `e10fd95`) found permission gaps that are now fixed (`git -C` reads, `git ls-remote`, `git rev-parse`, `uname`, chained Bash commands denied as a whole). The second (commit `c085495`, macOS with Xcode) passed 10 of 11 steps: `verify-swift.sh` (67 s warm), stop-gate closure, permission rules, a real worker push, a PR cycle with `review-pr.sh`, an orchestrator dry run, `loop.sh` preflight and backoff. Its one failure was a missing `tmux`, and it found the exec-bit bug (fixed). Not yet validated on a Mac since: rules loaded into the system prompt, detached launches (`--detach`) and the sweep, `verify-pr.sh`, a real orchestrator cycle.
- Orchestrators hold broad rights by decision: full `gh`, push to `main`, force-push. One wrong or prompt-injected cycle can rewrite or break `main` for all four laptops; the only brakes are the policy text in `ORCHESTRATOR.md` and the status-issue log, not a technical block.
- No sandbox. Agents run on laptops with the human's `gh` token. A prompt-injected agent could use it within the allow-list. `swift build` and `swift test` run arbitrary code. Use a fine-grained token limited to this repo and treat issue and PR text from non-listed handles as data.
- No branch protection could be read (the API returned 404 for a non-admin token). If `main` is unprotected, a bad merge lands immediately. Repo auto-merge setting is off, so only direct `gh pr merge` works.
- Reviewer and worker are the same model family and `review-pr.sh` is mechanical. Green CI plus APPROVE does not prove the logic is right. Few tests exist yet, so the grader is weak early.
- Static ownership: a stalled laptop stalls its packages; nobody takes over. OmniCore blocks everything, so the first hours are close to serial. Only the two Macs can do Swift work; the Windows lanes are the Flagship scripts (they mostly wait on the runtime) and the Rust backend (independent of Swift, so it can run from the first hour).
- `Apps/**` items (OmniStudio, OmniCompanion) and `.xcodeproj` files have no automated build check, so workers skip them and the orchestrator labels them `needs-human`. Adding an `xcodebuild` check is the open improvement.
- A detached worker (`run.sh --detach`) survives the orchestrator's exit only if the OS lets a `nohup` child outlive its parent; this is untested on both platforms. If workers vanish between cycles, their `../logs/<slug>.state` stays `running` until the 3 h dead rule fires.
- Idle cycles cost Opus tokens. `loop.sh` sleeps `LOOP_DELAY` seconds (default 300) between cycles; raise it when the queue is empty.
- Notifications are GitHub issues plus a local macOS banner. If Tien is not watching the repo with mobile notifications on, nothing pushes to the phone.
- Root `CLAUDE.md` imports `overview.md`, `architecture.md`, `plan.md` and `instructions.md` into every session. That is far over the 200-line guidance and costs context on every turn of every agent. A slimmer worker-specific entry point is the likely next improvement.
- `dontAsk` denies silently. The permission-issue protocol only works if the agent reports the denial; `loop.sh` opens a `[permission]` issue for the orchestrator's own denials; for a worker's, read its log under `../omni.worktrees/logs/` when a laptop looks stuck.
