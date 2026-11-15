Cloud API (provisional) — written 2026-11-14

Status: provisional contract between `PearCloud/CloudClient.swift` and the Rust backend (`Backend/src/api/*`, plan.md 4.2). Nothing in the backend exists yet; whoever builds it should match this or change both sides together. Sign-in method is not decided (overview.md Module 11), so token sign-in below is `[provisional: needs-tien-review]`.

Carries game content only. Never USIS packets or output commands.

All bodies are JSON. Authenticated routes send `Authorization: Bearer <sessionToken>`.

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
- The passwordless path (`PEAR_DEV_SIGNIN=1`) accepts only `"provider": "dev"`; any other provider is `400`, and it is `403` when the flag is off. Sign in with Apple (`/api/accounts/apple`) is a separate route and unchanged.
- Create the developer on the server (no HTTP): `PEAR_DEVELOPER_PASSWORD='...' pear-backend create-developer <username> "<display name>"`. Needs `DATABASE_URL`; username 3-32 chars of `[a-z0-9_-]`, password at least 12 chars; upserts `(provider "developer", subject <username>)`, prints the account id, re-running resets the password.
- Game JSON (`POST /api/games` 201, `GET /api/games`, `PUT /api/games/{id}`) is `{id, owner_id, owner_name, title, description, has_cover, created_at, updated_at}` (snake_case, as before). `owner_name` is the owner's display name, `description` is `""` by default, `has_cover` is a boolean.
- `GET /api/games` stays the caller's own games. `GET /api/games?all=1` returns every game for a developer and `403` for a player.
- `PUT /api/games/{id}` (auth; owner or developer) body `{"title"?: "...", "description"?: "..."}` (at least one; title 1-256 chars after trim, description at most 4000 bytes) returns 200 Game. 400 bad body or id, 403 not owner/developer, 404 no such game.
- `PUT /api/games/{id}/cover` (auth; owner or developer) raw body, `Content-Type: image/jpeg` or `image/png`, at most 2 MB, bytes must match the declared type. 204; 413 too large; 415 wrong or mismatched type; 403; 404. Stored in Postgres, so it survives redeploys.
- `DELETE /api/games/{id}/cover` (auth; owner or developer) returns 204 (also when there was none); 403; 404 no such game.
- `GET /api/games/{id}/cover` is public (no auth, like `GET /api/avatars/{id}`): image bytes with their `Content-Type` and `Cache-Control: no-cache`, or 404 when the game has no cover.
- `GET /api/library` entries (camelCase) gain `description` (string) and `coverUrl` (`"/api/games/{id}/cover?v=<updated_at in microseconds since the epoch>"` when the game has a cover, else `null`). Full entry: `{id, title, author, latestVersion, runMode, requiredTier, description, coverUrl}`. Changing metadata, a cover or publishing changes `v`.
