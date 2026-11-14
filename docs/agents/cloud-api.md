Cloud API (provisional) — written 2026-11-14

Status: provisional contract between `OmniCloud/CloudClient.swift` and the Rust backend (`Backend/src/api/*`, plan.md 4.2). Nothing in the backend exists yet; whoever builds it should match this or change both sides together. Sign-in method is not decided (overview.md Module 11), so token sign-in below is `[provisional: needs-tien-review]`.

Carries game content only. Never USIS packets or output commands.

All bodies are JSON. Authenticated routes send `Authorization: Bearer <sessionToken>`.

Routes

- `POST /v1/session` (no auth). Request `{"token": "<account token>"}`. Response `{"sessionToken": "...", "account": {"id": "...", "displayName": "..."}}`. 401 on a bad token.
- `POST /v1/games` (auth). Request: a game bundle (below). Creates a game owned by the account plus version 1. Response `{"gameId": "...", "version": 1}`.
- `POST /v1/games/{gameId}/versions` (auth). Request: a game bundle. Owner only (403 otherwise). Response `{"gameId": "...", "version": N}`.
- `GET /v1/games` (auth). Response `{"games": [{"id": "...", "title": "...", "latestVersion": N}]}` for the signed-in account.
- `GET /v1/games/{gameId}/versions/{N|latest}` (auth). Response `{"gameId": "...", "version": N, "bundle": <bundle>}`. 404 if absent.

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
