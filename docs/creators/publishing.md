# Publishing

1. File > Open from cloud... opens the account sheet. Sign in with the dev sign-in (a name), or the provider your host enables.
2. Pick or create a game. A game belongs to the account that created it.
3. File > Publish uploads the scene, client scripts and server scripts as a new version. The status line shows the version number; the Test panel checklist no longer lists "Not published".
4. Players joining after that get the new version. A live session whose game gets a newer version restarts its server script host: players receive a `_reload` event, `ctx.state` starts empty, and `onPlayerJoin` runs again for each connected player.

Uploaded: the scene, scripts, metadata (including run mode). Never uploaded: sensor data (USIS packets) or output commands. Simulated devices run in your page; only remote events reach the server.

Publishing needs the backend (`Deploy/dev.sh` runs one locally with an in-memory store, so data is lost on restart).
