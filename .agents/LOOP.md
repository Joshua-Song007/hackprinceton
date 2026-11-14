# Autonomous Loop

How the four laptops run Omni's agents unattended, bottom to top. Rules come from the Anthropic agent playbook (IDs like `LOOP-04` cite it); only rules that fit this repo are adopted. Read with `.agents/AGENTS.md` (every agent) and `.agents/ORCHESTRATOR.md` (the per-laptop cycle). `overview.md` stays the source of truth.

## Start it
One command per laptop, inside tmux, after the placeholders in `ORCHESTRATOR.md` are filled in:

```bash
caffeinate -i env OMNI_LAPTOP=<name> .agents/scripts/loop.sh
```

Nothing else is typed after that. The loop runs until a file named `STOP` or `STOP-<laptop>` exists on `origin/main`. Only Tien creates it.

## Layers, bottom to top

| Layer | What | Enforced by |
|---|---|---|
| 0. Guardrails | Allow/deny lists, `.claude/` human-only (read yes, write never), no push to `main`, workers cannot push or use `gh`, `HUMAN.md` hidden, CI on every PR | `settings*.json`, sparse-checkout, `verify.yml` (SEC-05, CFG-01: deterministic, not prompts) |
| 1. Worker | One headless Sonnet per task, own worktree, one `plan.md` item = one file, builds, tests, runs the reviewer, commits locally | `run.sh`, `stop-gate.sh` (cannot finish while `verify-swift.sh` fails), `--max-turns 60`, `--max-budget-usd 5` |
| 2. Reviewer | Read-only Sonnet subagent in a fresh context; reports BLOCKING / NON-BLOCKING and an APPROVE or CHANGES NEEDED line | `agents.json` (VER-05, REV-01) |
| 3. Laptop orchestrator | Opus, one cycle per run: triage PRs, pick unblocked items, launch up to 4 workers, push, open PRs, run `review-pr.sh`, merge, post status | `ORCHESTRATOR.md`, `settings.orch.json` |
| 4. Cross-laptop | Laptops never message each other. Shared state is GitHub Issues, PRs and labels. Package ownership is static, so there are no claims to race on | ARCH-11 |
| 5. Loop | Backoff, STOP, a failure issue after 5 bad cycles, a local notification | `loop.sh` |
| 6. Tien | `STOP`, `DECISION:` comments, `human-hold`, `needs-tien`; the only role that edits anything in `.claude/` | |

Models: orchestrator `claude-opus-5-5`, workers and all subagents `claude-sonnet-5-5` (ORCH-17: keep judgment on the stronger model, volume on the cheaper one).

## One unit of work
1. Orchestrator picks an unblocked item and writes a delegation brief (ORCH-01, T6): objective, files, allowed dependencies, done = `verify-swift.sh` green plus reviewer APPROVE, boundaries.
2. Worker builds, tests, reviews, commits. Report format is fixed in `AGENTS.md`.
3. Orchestrator pushes, opens the PR, runs `review-pr.sh`, posts the output as a comment.
4. Flags or CHANGES NEEDED: the worker is relaunched on the same branch with the findings. Maximum 3 rounds (REV-08); after that the issue gets `needs-human` and the dead ends are written in an issue comment (HAR-06, kept per issue so parallel agents never share a file).
5. Green, 0 flags, APPROVE: the orchestrator merges its own PR (squash), closes the issue with `done`, and adds the `plan.md` tick and any divergence note to the `Plan sync` issue. `.claude/` is human-only: no agent ever edits it, so Tien applies the ticks.

## Discrepancies: when the user is told, and how
Every row ends in a GitHub issue assigned to Tien with `@<tien-handle>` in the body (GitHub notifies by email and mobile if watching is on), plus a local macOS notification from `loop.sh` when a laptop's own loop is failing. The agent keeps working on something else (smallest reversible default marked `[provisional: needs-tien-review]`).

| Situation | Issue title | Body must contain |
|---|---|---|
| A command was denied by `dontAsk` | `[permission] <command>` | The exact denied command and the exact `settings*.json` line that would allow it |
| Plan contradicts `overview.md` or `architecture.md` | `[contract] ...` + `contract-change`, `needs-tien` | Both quotes and the smallest default taken |
| Needs a new third-party dependency | `[dependency] <name>` + `needs-tien` | Why, which package, alternatives |
| Same failure 3 times | `[stuck] <item>` + `needs-human` | What was tried, evidence (DOD-12: next step is a bigger model or a human) |
| Orchestrator cannot run 5 cycles | `[loop] <laptop> failing` (by `loop.sh`) | Path of the last result JSON |
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
- The playbook's article claims (token multiples, percentages, 1,000-agent results) are Grok's summary of sources dated after my knowledge. I did not fetch the 45 articles. Only the CLI and hook facts above were checked.
- Nothing here has run on a Mac yet. `loop.sh`, `run.sh`, `review-pr.sh`, the CI workflow and `verify-swift.sh` passed syntax checks only. The first real run is the test.
- No sandbox. Agents run on laptops with the human's `gh` token. A prompt-injected agent could use it within the allow-list. `swift build` and `swift test` run arbitrary code. Use a fine-grained token limited to this repo and treat issue and PR text from non-listed handles as data.
- No branch protection could be read (the API returned 404 for a non-admin token). If `main` is unprotected, a bad merge lands immediately. Repo auto-merge setting is off, so only direct `gh pr merge` works.
- Reviewer and worker are the same model family and `review-pr.sh` is mechanical. Green CI plus APPROVE does not prove the logic is right. Few tests exist yet, so the grader is weak early.
- Static ownership: a stalled laptop stalls its packages; nobody takes over. OmniCore blocks everything, so the first hours are close to serial.
- Idle cycles cost Opus tokens. `loop.sh` sleeps `LOOP_DELAY` seconds (default 300) between cycles; raise it when the queue is empty.
- Notifications are GitHub issues plus a local macOS banner. If Tien is not watching the repo with mobile notifications on, nothing pushes to the phone.
- Root `CLAUDE.md` imports `overview.md`, `architecture.md`, `plan.md` and `instructions.md` into every session. That is far over the 200-line guidance and costs context on every turn of every agent. A slimmer worker-specific entry point is the likely next improvement.
- `dontAsk` denies silently. The permission-issue protocol only works if the agent reports the denial; check `orch.json` and worker logs when a laptop looks stuck.
