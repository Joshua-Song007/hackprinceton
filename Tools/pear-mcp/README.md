# pear-mcp

Stdio MCP server that lets an agent build Pear games through the API only (no shell, filesystem or source tools).

Tools: `kit_reference`, `list_games`, `get_game`, `create_game`, `save_version`, `publish`, `read_logs`, `run_scenario`.
`save_version` creates a new latest version (non-script files such as `ui.json` become inline base64 version assets); `publish` re-saves an earlier version as the latest.
`run_scenario` spawns the headless runner in `Web/` (run `npm install` there once).
Game-building tools (`src/devtools.js`): `list_templates`, `get_template`, `validate_game`, `geo_path`, `geo_measure`, and `check_game` (offline: schema, self-check, `check.json` scenarios with N simulated phones on a virtual clock; see `Tools/pear-check/README.md`).

Env: `PEAR_CLOUD_URL` (default hosted), `PEAR_TOKEN`, or `PEAR_DEV_USER` + `PEAR_DEV_PASSWORD` (developer login), else passwordless dev sign-in. `PEAR_INSECURE=1` (automatic for sslip.io) accepts the self-signed cert.

```
cd Tools/pear-mcp && npm install && npm test   # test.mjs hits hosted; test-write.mjs uses a local mock API
```

Claude Code: `claude mcp add pear -- node /abs/path/Tools/pear-mcp/src/index.js` (add `-e PEAR_TOKEN=...` as needed).
Deep Agents (`Plugins/langchain-deepagents`): `PEAR_MCP_COMMAND=node PEAR_MCP_ARGS='["/abs/path/Tools/pear-mcp/src/index.js"]'`; unset, it defaults to this server.
