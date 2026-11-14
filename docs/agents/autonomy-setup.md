# One orchestrator, three remote workers, optional local workers

V2 replaces the four-planner default. The Python standard-library runtime performs coordination; `loop.sh` is a plain shell launcher with **no polling model**. Legacy tooling is retained for explicit `OMNI_LEGACY=1` use only. Do not run V1 and V2 simultaneously.

## Architecture and trust

- One designated laptop runs Opus to read `.claude/plan.md` once per changed cycle, compare implemented/merged work and create self-contained `ready` issues. The human plan remains read-only. There is no separate PLAN.md copy to drift.
- Three remote laptops, plus optional worker loops on the orchestrator laptop, run one issue at a time per loop in isolated worktrees, using Sonnet with a 35-turn cap. The shell handles claims, heartbeat, DoD, commits/push/PR publication and terminal status. Models cannot use gh or push. Sonnet helpers are optional within one issue.
- The sole orchestrator runtime launches a fresh Sonnet reviewer for the current PR SHA, requires independent DoD on a disposable hosted CI runner, and merges only after nonempty CI is all passing. It never executes PR build/test/lint code with its merge credentials. Maximum three reviews; corrections require an explicit planner retry, never a worker conversation.
- Shared coordination lives in `agent-control:state.json`. Git `--force-with-lease=refs/heads/agent-control:<expected-sha>` is CAS; every successful update appends a commit. Labels/assignees are eventually consistent mirrors, **not the lock**. No force update to main is used.
- The lease token fences publication after stale recovery. Exact-file intersections prevent parallel conflicting issues. A worker can claim unrelated work while its prior PR is reviewed.
- No production credentials belong on these machines. Issue check commands and PR test code execute locally with the machine account's authority; use dedicated clones/accounts and preferably disposable OS users/VMs. Tool permissions are not a security sandbox.

## Before deployment — human GitHub administrator

1. Stop all old loops and detached workers; collect their logs, branches and open PRs. Use the existing STOP mechanism first. Do not delete checkpoints. Clear STOP only when every old process is stopped. Existing `claimed:<laptop>` issues need a human review/release; V2 does not silently steal V1 work.
2. Merge the runtime PR, then its dependent launch/docs PR. Use fresh dedicated clones on all four machines; update them between nights. V2 deliberately does not rewrite a dirty clone or hot-reload running code.
3. Protect main with a ruleset: PRs required; required build/test/lint checks including `agent-dod`; strict/up-to-date checks or a merge queue; no force push/deletion; restrict updates/merges to the orchestrator bot/app identity; no bypass for workers or administrators used by automation. Confirm a worker token actually cannot update or merge main. `protected: true` is checked on startup, but the runtime cannot prove every ruleset policy from that flag.
4. Use a **different GitHub identity per machine**, not four PATs for the same human. Fine-grained repo-only credentials: workers need Contents read/write (own branches + agent-control), Issues read/write (claim mirrors/status), Pull requests read/write (create only); no Actions/Workflows write, administration, secrets or organization permissions. Orchestrator needs those plus permission to merge under main's rules. None needs admin/bypass. PAT scope cannot distinguish “create PR” from “merge PR”: server rules are mandatory. Restrict worker branch updates with a ruleset to their own `agent/<laptop>/**` and `agent-control` where possible.
5. Set repository Actions variable `OMNI_ORCHESTRATOR_LOGIN` to the orchestrator bot login. Enable `.github/workflows/agent-dod.yml`: it checks out the trusted base-branch verifier and runs each V2 PR's brief checks on an ephemeral macOS runner with read-only GitHub permissions and no merge credentials. Create labels `ready`, `claimed`, `in-review`, `blocked`. All bots need permission to read/push agent-control; the branch is created on the first CAS. Do not delete/rewrite it while loops run. Provision git user.name/user.email in each clone.
6. Install git, gh, Python 3.10+, Claude Code with the flags used by autonomy.py, plus the toolchains named in briefs. Pin/verify the configured model IDs are available to your account. No paid “reply ok” preflight is made.
7. Run the offline dry run on every platform before starting. Initial CI provides Windows/macOS/Linux coverage; local validation alone is not Mac proof.

## Shared environment (all four machines)

Git Bash/macOS Bash:

```bash
export OMNI_ORCHESTRATOR_LOGIN=your-orchestrator-bot
export OMNI_ORCHESTRATOR_LAPTOP=tien-laptop
export LOOP_DELAY=60
export CLAIM_TTL=900
export LIMIT_WINDOW=18000
# Optional: observed local token-window budget; pause at 90%.
# Counts cache reads separately in telemetry, but this cap uses all CLI tokens.
export WORKER_TOKEN_LIMIT=1000000
```

Keep machine secrets in the OS credential store/environment, never repo files. Authenticate gh and Claude once manually. With subscription OAuth, leave OMNI_BARE unset: project root CLAUDE.md and .claude/ are sparsely absent in model worktrees and personal settings are excluded. Claude may still discover user-level/global CLAUDE.md; audit/slim those on each machine. This cannot guarantee a zero-global-context process with OAuth.

For strongest context isolation, use API-key auth and `export OMNI_BARE=1` plus ANTHROPIC_API_KEY. The installed CLI's `--bare` disables CLAUDE.md discovery, auto-memory, plugin/hooks and keychain/OAuth. It is **not** compatible with subscription-only login. Tools/jev-hooks remains untouched; V2 does not automatically load expensive legacy Stop hooks. DoD replaces their correctness gate.

## Orchestrator laptop

```bash
bash .agents/scripts/dry-run.sh
bash .agents/scripts/start.sh tien-laptop --orch --dry-run
# In tmux on macOS; start.sh uses caffeinate there.
bash .agents/scripts/start.sh tien-laptop --orch
```

### Workers on the orchestrator laptop

The planner laptop can contribute implementation capacity as well. These are ordinary supervised worker shells, not additional orchestrators:

```bash
# Separate worker identity/token, blocked from merging main by the same ruleset.
export OMNI_LOCAL_WORKER_GH_TOKEN=your-worker-bot-token
bash .agents/scripts/start.sh tien-laptop --orch --local-workers 2
```

Logical IDs are `tien-laptop-local-1`, `tien-laptop-local-2`, etc. They claim through the same CAS, use separate worktrees, run Sonnet, and report through the same issue/PR protocol. Their GitHub CLI and HTTPS Git credential helper use the worker token instead of inheriting the orchestrator credential. Use an HTTPS origin with gh authentication. Do not use an SSH remote backed by an orchestrator key for local workers. Zero to four local workers are supported; start with one to avoid oversubscribing RAM/build tools and **the same Claude account's quota**. These workers have no separate model quota just because they have separate loop IDs. Telemetry aggregates their sessions in the same local nightly directory. Local workers automatically share the orchestrator's quota-group key, so a detected 429 or configured group cap pauses sibling model launches too. If remote laptops share that same provider account, explicitly set the same `OMNI_QUOTA_GROUP` on those machines. Provider-account headroom and the reset window still require conservative calibration.

The orchestrator supervisor signals a private local STOP file and waits for local workers to finish/checkpoint when it exits. Global STOP also reaches them through agent-control. A crashed child stops the supervisor rather than silently restarting/spending more sessions; inspect its `<logical-worker>.out` and stale lock before restarting. Local workers continue during ordinary planner idle cycles, not only while an Opus session is active.

Only OMNI_ORCHESTRATOR_LAPTOP can opt into Opus. A local exclusive lock also prevents duplicate launches. Snapshot fingerprints include main, issue/comment updates, PR head and CI changes; heartbeat-only coordination commits do not wake the planner. Successful unchanged snapshots skip model calls. A state change during a planning call is deliberately observed on the next cycle, even if that occasionally causes one follow-up cycle for the planner's own issue creation.

The planner must inspect merged PRs and named source files, not just unchecked boxes. It can create issues and explicitly retry corrected briefs; it cannot invoke merge tooling. The runtime is the only merger. Pending/failing CI defers only that PR; it does not block other reviews or the next planning cycle. Comments only report actionable review/unblocking information, not acknowledgements or plan-sync chatter.

## Worker laptops

```bash
# Each uses its OWN GitHub identity and unique stable laptop name.
bash .agents/scripts/start.sh worker-one --worker
# On the other two machines: worker-two, worker-three.
```

No worker polling call spends model tokens. `ready` briefs must be authored by OMNI_ORCHESTRATOR_LOGIN. Claims are CAS-protected before label/assignee updates; a failed mirror does not grant a second worker the issue. Missing/malformed briefs and wrong-platform work are not claimed. Swift/Apps/Packages changes require macOS, so assign appropriate machines and avoid starving that queue with three Windows workers.

Windows: keep Git Bash open, plugged in, lid open, and disable OS idle sleep for the night; the new foreground launcher does not silently change power settings or spawn detached windows. macOS: use tmux plus the automatic caffeinate wrapper. Laptop lid sleep is not prevented. Local exclusive lock directories are under `<clone>.worktrees/nightly`; after a hard kill, verify no process remains before removing the stale `<laptop>-<role>.lock` directory.

## Brief format

Issue body is the complete task. Exact files include every required caller/test/fixture/manifest. Quote relevant plan lines and dependency constraints; do not tell workers to read full docs.

````text
```agent-brief
{
  "goal": "Fix the bounded behavior",
  "files": ["Backend/src/example.rs", "Backend/tests/example.rs"],
  "plan_quotes": ["verbatim relevant .claude/plan.md line and item ID"],
  "acceptance": ["Regression test fails before fix and passes afterward"],
  "platform": "any",
  "checks": {
    "build": "cargo build --manifest-path Backend/Cargo.toml --all-targets",
    "tests": "cargo test --manifest-path Backend/Cargo.toml",
    "lint": "cargo clippy --manifest-path Backend/Cargo.toml --all-targets -- -D warnings"
  }
}
```
````

The illustrative paths must be replaced with real files. All three commands must exit zero. Tests require positive counts parsed from unittest, pytest, Rust, Swift or node:test output; unsupported test reporters fail closed and need a small parser test before use. Syntax-only and zero/all-skipped suites do not pass. A malicious check can fabricate output; trusted orchestration plus independent review/required CI are still necessary. Workers cannot change protected automation files with their default model permissions; human/tooling maintenance PRs handle those rather than bypassing denial rules.

## Failures, capacity and takeover

- Heartbeat every 60 seconds while a model/check runs. Shared worker status includes heartbeat, issue, observed completed-session window tokens, last detected quota/429, estimated reset epoch. In-flight token usage is not available from the CLI's final-JSON output; heartbeats do not pretend to measure it. There is no API here for account-wide remaining subscription quota. `LIMIT_WINDOW` is a conservative fallback, **not a provider promise**. CLI errors without observable token usage are recorded, not invented.
- At quota/error, attempt to commit/push the allowed-file checkpoint, post one structured status, and release to ready. Near-budget successful work can finish its PR before cooldown. Worktree setup is serialized through the existing-style `.setup.lock` to avoid concurrent Git config writes; remove a stale setup lock only after confirming no setup process remains. All local worktrees are retained, including dirty interrupted ones; inspect disk usage and use existing cleanup tooling only after confirming ownership/PR state.
- The first retry uses higher effort; a third attempt cannot use the same worker. After the third failure, blocked. The planner supplies the prior checkpoint/review findings in a corrected brief. Checkpoints are retained and referenced, not automatically cherry-picked without review.
- The orchestrator sweeps claims older than CLAIM_TTL and mirrors ready/blocked state. A stale original process loses publication rights. If the orchestrator laptop is offline, workers finish/report but no planning/review/merge or stale sweep occurs; that is intentional single-owner behavior. To take over, stop the old orchestrator, update the designated laptop ID everywhere and launch exactly one replacement. Legacy alphabetical takeover logic remains archived, not active with four planners.
- Correct a brief/reassign with the designated orchestrator environment:

```bash
OMNI_ROLE=orch OMNI_LAPTOP="$OMNI_ORCHESTRATOR_LAPTOP" python .agents/scripts/autonomy.py retry 123
```

This closes a superseded review PR, preserves attempt/review budgets, then requeues. Maximum three review contexts total; a rejected SHA is not re-reviewed endlessly. Exhausted budgets require human resolution/new scoped issue, not an automatic reset.

## STOP and rollback

```bash
# From the designated orchestrator environment: global shared kill switch
OMNI_ROLE=orch OMNI_LAPTOP="$OMNI_ORCHESTRATOR_LAPTOP" python .agents/scripts/autonomy.py stop
# Local machine only: touch STOP (or STOP-<laptop>) in its primary clone.
# A STOP file on origin/main also stops loops after fetch.
# Only after inspecting claims/checkpoints:
OMNI_ROLE=orch OMNI_LAPTOP="$OMNI_ORCHESTRATOR_LAPTOP" python .agents/scripts/autonomy.py resume
```

STOP prevents further launches/publication/merges. Local STOP files also cancel active model/check subprocess trees, allowing the checkpoint handler to run. Shared STOP is rechecked at publication/merge boundaries; an in-flight remote model may finish its bounded session. SESSION_TIMEOUT defaults to 1800 seconds, CHECK_TIMEOUT to 900 seconds per command, and network/Git commands to 120 seconds. Hung commands are terminated instead of heartbeating forever. Local supervised workers get 90 seconds to exit after their private STOP, then their process tree is terminated. Shared STOP latency can still be one bounded session, so it is not an instantaneous emergency kill. Revoke credentials/terminate processes for an immediate security incident. If any coordination/network check fails, publication/merge fails closed; recover claims by stale sweep when connectivity returns.

Rollback: stop all V2 loops, retain coordination/log/checkpoint history, revert launch wiring through a reviewed PR, and only then explicitly use OMNI_LEGACY=1. Do not combine V1 takeover with V2 leases. Legacy maintain.sh is preserved but excludes AUTONOMY-V2 PRs from its merge path.

## Telemetry, context and validation

```bash
# Purely offline: temp bare Git repos, CAS race and mocked model/GitHub cycle.
bash .agents/scripts/dry-run.sh
# Pure launcher preview: no network, model, or writes.
bash .agents/scripts/start.sh worker-one --dry-run
bash .agents/scripts/start.sh tien-laptop --orch --local-workers 2 --dry-run
python .agents/scripts/autonomy.py summary
python .agents/scripts/autonomy.py pack
```

Per-session result/prompt/usage files are unique under `<clone>.worktrees/nightly/`; nightly-summary.json is grouped by UTC date and role (sessions, root turns, cost estimate, fresh/cache-created/cache-read/output tokens). It is local to each machine; copy the four usage directories into one collector and run summary with OMNI_LOGS set there to obtain a fleet total. Do not add the same session twice. CLI modelUsage is retained for subagent accounting; root num_turns is not a separately measured total of all subagent turns. On subscriptions USD is a relative estimate, not an invoice. Logs contain task/code content; keep them private and set retention deliberately.

`docs/agents/context-source.txt` is the small maintained convention source; context-pack.md is generated from it and the merged tree's directory/package map. The runtime regenerates the local pack after each merge and before planning, and loads that stable text before role instructions. It does not commit a context-only PR after every merge or edit the human plan. Changed source conventions require a reviewed PR; workers cannot infer arbitrary new architecture automatically. A compact pack under 3k tokens is intentional, not padded to reach a quota.

Known limits: queue/snapshot queries cap at 200 ready/300 total issues and 100 open PRs; keep the overnight queue bounded and add pagination before exceeding that scale. Coordination history and retained worktrees grow; archive during a stopped maintenance window. No auto-update, provider-specific reset parser, production sandbox or broad-plan compression was added. Live multi-machine/Claude execution and administrator ruleset validation remain deployment gates.
