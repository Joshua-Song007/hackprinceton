Cloud API (provisional) — written 2026-11-14

Status: provisional contract between `PearCloud/CloudClient.swift` and the Rust backend (`Backend/src/api/*`, plan.md 4.2). Nothing in the backend exists yet; whoever builds it should match this or change both sides together. Sign-in method is not decided (overview.md Module 11), so token sign-in below is `[provisional: needs-tien-review]`.

Carries game content only. Never USIS packets or output commands.

All bodies are JSON. Authenticated routes send `Authorization: Bearer <sessionToken>`. Sign-in sessions persist in Postgres for 30 days, sliding (each use pushes the expiry out, written at most once an hour), so they survive server restarts; only the token hash is stored, and sign-out or account deletion ends them. Without a database sessions are in memory only.

Routes

- `POST /v1/session` (no auth). Request `{"token": "<account token>"}`. Response `{"sessionToken": "...", "account": {"id": "...", "displayName": "..."}}`. 401 on a bad token.
- `POST /v1/games` (auth). Request: a game bundle (below). Creates a game owned by the account plus version 1. Response `{"gameId": "...", "version": 1}`.
- `POST /v1/games/{gameId}/versions` (auth). Request: a game bundle. Owner only (403 otherwise). Response `{"gameId": "...", "version": N}`.
- `GET /v1/games` (auth). Response `{"games": [{"id": "...", "title": "...", "latestVersion": N}]}` for the signed-in account.
- `GET /v1/games/{gameId}/versions/{N|latest}` (auth). Response `{"gameId": "...", "version": N, "bundle": <bundle>}`. 404 if absent.
- Live play (Backend `game_server/session.rs`): `GET /play/{gameId}?token=..&version=n&lobby=CODE` (WebSocket). `lobby` is optional, 4-8 chars `[A-Z0-9]`, case-insensitive (uppercased); invalid is 400; missing joins the shared lobby `OPEN`. A session is one `(gameId, lobby)`; joining an unused code creates it. The `_welcome` frame data is `{"id", "name", "lobby"}`. The server pings every 10 s and drops a socket silent for 30 s (`onPlayerLeave` fires). `/debug/{gameId}` takes an optional `?lobby=` (default `OPEN`).
- `GET /api/games/{gameId}/lobbies` (auth). Response `[{"code": "AB12C", "players": [{"id": "...", "name": "..."}]}]`, live lobbies only (in-memory, nothing stored; `OPEN` included when live).
- `GET /api/friends` entries: `playing` is `{"gameId", "title", "lobby"}` or null.

Game bundle

```json
{
  "title": "string",
  "runMode": "screen | device",
  "scene": { "...": "SceneDescription JSON, passed through untouched" },
  "clientScripts": [{ "name": "enemy", "source": "..." }],
  "serverScripts": [{ "name": "game", "source": "..." }],
  "assets": [{ "name": "a.png", "contentType": "image/png", "data": "<base64>" }]
}
```

Errors

- 401 `unauthorized` (the client clears its stored session), 403 `forbidden`, 404 `notFound`; any other non-2xx is `server(status, message)` with the first 512 bytes of the body. Network failures are `transport`, undecodable 2xx bodies are `decoding`. Calling an authed method before sign-in is `notSignedIn` without any request.

Client notes

- `CloudClient` is an actor; the session token lives in memory only (no Keychain yet).
- `baseURL` and `URLSession` are injected; tests stub the session with a `URLProtocol`.

Developer accounts, game metadata and covers (Backend `api/accounts.rs`, `api/games.rs`, `api/library.rs`; implemented, field names are as served)

- Roles: every account JSON (`POST /api/accounts/signin` response `account`, `GET /api/accounts/me`) has `"role": "player" | "developer"` next to `id`, `provider`, `subject`, `display_name`, `created_at`. A developer passes every owner check (publish version, delete game, edit metadata, cover) on any game.
- `POST /api/accounts/signin` with `{"provider": "developer", "subject": "<username>", "password": "<password>"}` (no auth). Same 200 shape as before (`{token, account}`). Works whether or not `PEAR_DEV_SIGNIN` is set. Wrong password and unknown username give the identical `401` after a fixed ~400 ms delay; it never creates an account. Passwords are stored as argon2id hashes and are never logged. 400 for an empty subject or a password over 1024 bytes, 503 without a database.
- `POST /api/accounts/signup` with `{"username", "password", "display_name"}` (no auth) creates a `player` account and returns the same `{token, account}` body. Username 3-32 of `[a-z0-9_-]`, password 10-1024 chars (`400` with a message otherwise), `409` when the username is taken (after the same ~400 ms delay), `503` without a database. Sign in later with `{"provider": "password", "subject": "<username>", "password": "<password>"}`: same `200` shape, same identical delayed `401` as `developer`. Developer accounts stay CLI-only.
- Passwordless `dev` sign-in additionally requires the subject to start with `PEAR_DEV_SIGNIN_PREFIX` (default `sim-`; set to an empty string to disable the check, as `Deploy/dev.sh` does locally); otherwise `403`.
- The passwordless path (`PEAR_DEV_SIGNIN=1`) accepts only `"provider": "dev"`; any other provider is `400`, and it is `403` when the flag is off. Sign in with Apple (`/api/accounts/apple`) is a separate route and unchanged.
- Create the developer on the server (no HTTP): `PEAR_DEVELOPER_PASSWORD='...' pear-backend create-developer <username> "<display name>"`. Needs `DATABASE_URL`; username 3-32 chars of `[a-z0-9_-]`, password at least 12 chars; upserts `(provider "developer", subject <username>)`, prints the account id, re-running resets the password.
- Game JSON (`POST /api/games` 201, `GET /api/games`, `PUT /api/games/{id}`) is `{id, owner_id, owner_name, title, description, has_cover, created_at, updated_at}` (snake_case, as before). `owner_name` is the owner's display name, `description` is `""` by default, `has_cover` is a boolean.
- `GET /api/games` stays the caller's own games. `GET /api/games?all=1` returns every game for a developer and `403` for a player.
- `PUT /api/games/{id}` (auth; owner or developer) body `{"title"?: "...", "description"?: "..."}` (at least one; title 1-256 chars after trim, description at most 4000 bytes) returns 200 Game. 400 bad body or id, 403 not owner/developer, 404 no such game.
- `PUT /api/games/{id}/cover` (auth; owner or developer) raw body, `Content-Type: image/jpeg` or `image/png`, at most 2 MB, bytes must match the declared type. 204; 413 too large; 415 wrong or mismatched type; 403; 404. Stored in Postgres, so it survives redeploys.
- `DELETE /api/games/{id}/cover` (auth; owner or developer) returns 204 (also when there was none); 403; 404 no such game.
- `GET /api/games/{id}/cover` is public (no auth, like `GET /api/avatars/{id}`): image bytes with their `Content-Type` and `Cache-Control: no-cache`, or 404 when the game has no cover.
- `GET /api/library` entries (camelCase) gain `description` (string) and `coverUrl` (`"/api/games/{id}/cover?v=<updated_at in microseconds since the epoch>"` when the game has a cover, else `null`). Full entry: `{id, title, author, latestVersion, runMode, requiredTier, description, coverUrl}`. Changing metadata, a cover or publishing changes `v`.

## Hosting: status, assets, instances, storage runbook

- `GET /api/status` is public: `{ok, version, storage: "s3"|"memory", database: "postgres"|"memory"}`; `version` is `<crate version>+<PEAR_BUILD>` (`PEAR_BUILD` = git short sha from `deploy.sh`, `dev` otherwise). With a developer bearer it adds `storage_detail {description: "s3 <bucket> @ <endpoint>" | "memory", probe: {ok, reason?, at} | null}`, `instances`, `players`, `uptime_s`, `limits {max_instances, max_players_per_instance, max_asset_bytes}`. A storage probe runs once at startup and is cached; a developer forces a fresh one with `?probe=1`.
- `PUT /api/games/{id}/assets/{name}` (owner or developer) raw body at most 10 MB, `name` is `[A-Za-z0-9._-]{1,128}`, `Content-Type` one of image/png, image/jpeg, audio/mpeg, audio/wav, audio/x-wav, audio/ogg, text/html, text/css, application/javascript, application/json. Stores the bytes at `assets/<sha256>` (identical bytes dedup; type in the sidecar `assets/<sha256>.type`). Returns 200 `{name, sha256, size, content_type}`; 400 bad name/id/empty body, 401, 403, 404 no game, 413, 415.
- `GET /api/assets/{sha256}` is public: bytes, stored `Content-Type`, `Cache-Control: public, max-age=31536000, immutable`, `ETag: "<sha256>"` (304 on `If-None-Match`), `X-Content-Type-Options: nosniff`; `text/html` also gets `Content-Disposition: inline`. 404 unknown.
- `POST /api/games/{id}/versions`: every `assets` entry that is an object with a `sha256` must name a stored asset, else 400. Entries without `sha256` are not checked.
- `GET /api/instances` (developer; 401/403 otherwise) lists live sessions `[{game_id, title?, lobby, version, players: [{id, name}], started_at, last_activity_at}]` (`last_activity_at` = last inbound frame). `DELETE /api/instances/{game_id}/{lobby}` closes a session (players' sockets end), `DELETE /api/instances/{game_id}/{lobby}/players/{player_id}` drops one player through the normal leave path; both 204, or 404 when not live.
- Limits (env, read per request): `PEAR_MAX_INSTANCES` (default 200) makes `/play` answer 503 before the upgrade when a new lobby would exceed it; `PEAR_MAX_PLAYERS_PER_INSTANCE` (default 16) answers 409 for a new player in a full lobby. A reconnect by a player already in the lobby is always admitted.
- Storage env: `PEAR_S3_ENDPOINT` (`https://atl2.vultrobjects.com`), `PEAR_S3_REGION` (default `us-east-1`), `PEAR_S3_ACCESS_KEY`, `PEAR_S3_SECRET_KEY`, `PEAR_S3_BUCKET`, optional `PEAR_S3_PREFIX` (e.g. `prod/`, prepended to every key so environments can share a bucket). Empty values count as unset; without them blobs live in memory and are lost on restart (logged at startup).
- Runbook. Keys live only in `/etc/pear/storage.env` on the server (root, mode 600 in a 700 dir); `Deploy/docker-compose.yml` hands that file to the backend container alone (`env_file`, optional). Never put a key value in the repo, logs or a command line.
  - First time or rotate: on the server as root `bash /opt/pear/Deploy/configure-storage.sh` (asks only for missing values, secret hidden, bucket default `pear-prod`; writes the file atomically; runs `pear-backend storage-check` (create bucket if missing, write/read/delete a probe); restarts the backend only if that passes, otherwise restores the previous file). To change a value, delete its line from the file first.
  - Check by hand: `cd /opt/pear/Deploy && docker compose run --rm backend /app/pear-backend storage-check` (prints the backend description and ok/FAILED; exit 0/1).
  - Deploy from a laptop: `bash Deploy/deploy.sh` (`PEAR_SSH_HOST`, default `pear-vultr`); it pulls, rebuilds with `PEAR_BUILD` and polls `/api/status` for up to 180 s, printing version and storage.
