## Phase 10: Marketplace cloud follow-ups (after PR #161)

Goal: move the plugin marketplace from the dev box (in-memory store, `OMNI_PLUGIN_SEED_DIR`, per-browser state, local model key) to hosted, per-account services. Nothing here is built; each item lists what it touches and when it is done. Source: WISHLIST and Debt in `docs/agents/progress/omni-marketplace.md`.

### 10.1 Hosted registry on Vultr
Goal: the plugins routes run against Postgres on the Vultr host, filled by a publish/seed job instead of `OMNI_PLUGIN_SEED_DIR`.
- Touches: `Backend/src/api/marketplace.rs` (seed path, blocking `std::fs` at :89), `Backend/src/db.rs`, `Backend/migrations/0002_plugins.sql`, `Deploy/docker-compose.yml`, `Deploy/vultr-bootstrap.sh`.
- Done when: the hosted backend lists and installs `langchain-deepagents` with `DATABASE_URL` set and no seed dir; the seed job is idempotent (a second run changes nothing) and applies the `[a-z0-9-]` id rule; a `Backend/tests` case runs against Postgres.
- Status (2026-11-14): built. `omni-backend seed <dir>` job (also run by `vultr-bootstrap.sh` when `OMNI_S3_*` is in `.env`); migration `0003_marketplace_cloud.sql` replaces the 0002 table (old rows dropped, re-seed); the seed refuses Postgres without S3. Verified locally against Postgres 17 + an S3-compatible server (SeaweedFS): listed and fetched with no seed dir, second seed run unchanged, bad id skipped; `tests/marketplace.rs` runs on Postgres when `DATABASE_URL` is set. NOT DONE: run on the Vultr box (needs push + redeploy). `OMNI_PLUGIN_SEED_DIR` kept for the dev box only.

### 10.2 Bundle object storage
Goal: bundles are tarballs in Vultr Object Storage with content hashes and signatures, not JSON file maps in a JSONB column.
- Touches: `Backend/src/api/marketplace.rs`, `Backend/src/db.rs`, a new migration (hash, signature, object key), `Web/studio/src/marketplace`, `Web/studio/src-tauri/src/plugins.rs` (verify before unpack).
- Done when: install downloads the tarball, checks the SHA-256 and signature, and refuses a tampered bundle (test with one flipped byte); `uv.lock` and dotfiles are included, so the 256 KiB per-file rule no longer drops them.
- Status (2026-11-14): built. Deterministic gzip tarballs (`Backend/src/bundle.rs`), `plugins/<id>/<sha256>.tar.gz` in S3 via hand-rolled SigV4 (`blobs.rs`, checked against the AWS doc vector and a real S3 server; memory store when `OMNI_S3_*` unset), Ed25519 signature over id/version/sha (`crypto.rs`). Tauri `install_plugin` verifies hash + signature + manifest before writing; the browser installer verifies with WebCrypto. One-flipped-byte tests in `plugins.rs` and `marketplace.test.ts`. The public key is fetched from the registry (`/api/plugin-signing-key`): covers tampered storage/transit, not a compromised registry; pin the key at build time to cover that. NOT DONE: Vultr bucket (human, paid).

### 10.3 Authenticated publish API
Goal: authors publish plugins with an account; versions are kept and installed plugins can update.
- Touches: `Backend/src/api/marketplace.rs`, `Backend/src/api/accounts.rs`, `Backend/src/db.rs`, a new migration (author, version, status), `Web/studio/src/marketplace` (update button, version shown).
- Done when: unauthenticated publish returns 401; a second publish of the same id needs a higher version; the Studio shows "update available" and updates in place; review/moderation state is stored and unreviewed plugins are not listed.
- Status (2026-11-14): built. `POST /api/plugins` takes a gzip tarball; new versions are `pending` until an account in `OMNI_PLUGIN_REVIEWERS` approves; seeded plugins have no author and cannot be published over. Versions are numeric dotted only (`1.2.3`, no pre-release tags). Studio shows "Update to vX" and reinstalls in place. No publish UI in Studio: authors use curl.

### 10.4 Install telemetry
Goal: installs are recorded per account, and uninstall lowers the count (today it only goes up and counts reinstalls).
- Touches: `Backend/src/api/marketplace.rs`, `Backend/src/db.rs`, a new migration (install records per account and plugin), `Web/studio/src/marketplace`.
- Done when: install, reinstall and uninstall leave the count equal to the number of accounts with the plugin installed; a test covers all three.
- Status (2026-11-14): built. `plugin_installs` row per (plugin, account); uninstall marks the row; count = accounts installed now. Signed-out installs are not counted.

### 10.5 Installed-plugin sync across devices
Goal: installed plugins follow the account (cloud projects) instead of per-browser localStorage.
- Touches: `Backend/src/api/marketplace.rs` (list my installs, built on 10.4 records), `Web/studio/src/marketplace`, `Web/studio/src-tauri/src/plugins.rs` (install on a second device).
- Done when: installing on device A shows the plugin as installed on device B after sign-in, and uninstalling on A removes it on B after refresh.
- Status (2026-11-14): built. `GET /api/me/plugins`; Studio syncs on boot, on Refresh and on sign-in; auto-install skips a plugin the account uninstalled elsewhere. Records are per account, not per project.

### 10.6 Hosted agent runtime for browser mode
Goal: browser mode works without a local `uv` process on :9410.
- Touches: `Plugins/langchain-deepagents/runtime`, `Deploy/` (run the runtime beside the backend), `Web/studio/src/marketplace` (runtime URL), `Backend/src/lib.rs` (proxy and auth).
- Done when: a signed-in browser user with no local runtime gets an agent reply; the runtime accepts only authenticated requests; one runtime per project still holds.
- Status (2026-11-14): built. `Deploy/runtime.Dockerfile` + compose `runtime` service (no published port); backend `/agent/ws` + `/agent/health` proxy; runtime hosted mode needs `OMNI_RUNTIME_SECRET`, dir per account/project, per-project lock kept. Signed-in browsers use it; desktop keeps the local runtime with env keys. Checked end to end locally (signed-in client -> backend -> runtime container -> Anthropic answered 401 to a fake key). NOT DONE: a real reply (needs a key, 10.8) and a run on Vultr.

### 10.7 Per-account model API keys
Goal: the model API key is stored per account on the server, not in a local env var.
- Touches: `Backend/src/api/accounts.rs` or a new route, `Backend/src/db.rs`, a new migration (encrypted secret), `Plugins/langchain-deepagents/runtime` (read the key per request), `Web/studio/src/marketplace` (key form).
- Done when: a key saved by one account is used only for that account's requests; it is encrypted at rest and never returned by any API; a test checks both.
- Status (2026-11-14): built. `PUT/GET/DELETE /api/me/model-key`, AES-256-GCM under `OMNI_SECRET_KEY`, key never returned; key form in the Marketplace panel. Used by the hosted runtime only (desktop local runtime still reads env keys).

### 10.8 Live-model verification
Goal: the live AI path is run once for real; today only `OMNI_AGENT_FAKE=1` is exercised.
- Touches: `Plugins/langchain-deepagents/runtime` (default model ids), `docs/agents/progress/omni-marketplace.md` (record results).
- Status: Anthropic and Google keys are untested; OpenAI is blocked on account credits; the Google default model id is unverified.
- Done when: one prompt succeeds per provider (or is recorded as blocked with the reason), the Google default model id is confirmed against the provider's model list, and the demo notes say which providers were run live.
- Status (2026-11-14): Anthropic PASSED on the hosted Vultr runtime (account key saved in the Marketplace panel, real model reply). OpenAI and Google not run yet; Google default model id still unverified. Recorded in `docs/agents/progress/omni-marketplace.md`.

### 10.9 Remaining marketplace fixes (open after PR #162)
- [x] Ship `uv.lock` in bundles: raise `MAX_FILE_BYTES` to 1 MiB in `Backend/src/api/marketplace.rs` (done and tested on branch `agent/tienvu-lol/omni-ws1-registry`; needs review and merge). (2026-11-14: done on main instead: tarball bundles, 1 MiB per file, dotfiles kept; that branch is not on the remote.)
- [x] Seed-time plugin id rule `^[a-z0-9-]{1,64}$` in `read_plugin`; skip and log bad ids.
- [x] `src-tauri/src/plugins.rs`: key `Runtimes` by (project, plugin); `write_bundle` clears the old plugin dir after validation (no stale files on reinstall).
- [x] `Web/studio/src/marketplace/installer.ts`: browser start hint still mentions `OMNI_AGENT_FAKE=1`; remove it (fake mode is gone).
- [x] Runtime: sanitise provider exception text in `error` events (a provider could echo a key); do not hold the project lock while sending to a slow socket.
- [x] Non-Windows `stop_runtime` kills only the direct child; use process groups so `uv` leaves no orphaned python.
- [x] Postgres paths (0002 migrate guard, upsert, installs) have no CI run; add a `DATABASE_URL` job. (2026-11-14: `.github/workflows/backend-postgres.yml`, never run on CI; same tests pass locally on Postgres 17.)
- [ ] Live model run: OpenAI key has no credits; Anthropic and Google untested; Google default model id unverified.

## Later changes

### 2026-11-14 — Instructions and player agents in the Deep Agents plugin
Paths: `Plugins/langchain-deepagents/runtime/instructions.py`, `Plugins/langchain-deepagents/runtime/players.py`, `Plugins/langchain-deepagents/runtime/server.py`, `Plugins/langchain-deepagents/runtime/translate.py`, `Plugins/langchain-deepagents/pear-plugin.json`, `Web/studio/src/panels/deep-agent.ts`

Plugin 0.7.42 (Phase 12.2, see plan.md). `prompt` takes `mode` `scripts` or `instructions`; the instructions agent reads the project but cannot write files and saves only through `submit_instructions` (checked, retried on "Error"), forwarded as one `file_written` `instructions.json` that the panel holds as a proposal (Accept / Reject) and never applies by itself. An instructions run applies no script or scene write. `decide` returns a `plan` {actions, unsure} and `report` a `report_result` {unsure, summary} for agent players: one deep agent per (run, player), memory thread, default in-memory backend (no disk), recursion limit 10, 60 s timeout, 120 calls per player (`PEAR_PLAYER_CALL_CAP`), 32 agents per connection, model `PEAR_PLAYER_MODEL` outside hosted mode. Actions: walk_to, look_at, gesture, give_device, say, wait.

Known, not changed: a `prompt` in flight delays reading `decide`; a run that stops without `report` keeps its agents until the connection closes; each decide pays the deep agent's built-in prompt; no cost meter yet (12.3); quality of the authoring and player agents is not tested against a live model.

- [x] `Plugins/langchain-deepagents/runtime/instructions.py`, `Plugins/langchain-deepagents/runtime/players.py`, `Plugins/langchain-deepagents/runtime/server.py`, `Plugins/langchain-deepagents/runtime/translate.py`.
- [x] `Plugins/langchain-deepagents/tests/test_instructions.py`, `Plugins/langchain-deepagents/tests/test_players.py`, `Plugins/langchain-deepagents/tests/test_translate.py`.
- [x] `Plugins/langchain-deepagents/pear-plugin.json`, `Plugins/langchain-deepagents/pyproject.toml`, `Plugins/langchain-deepagents/uv.lock`.
- [x] `Web/studio/src/panels/deep-agent.ts`, `Web/studio/test/deep-agent.test.ts`.
