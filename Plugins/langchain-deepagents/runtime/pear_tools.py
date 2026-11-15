"""Pear MCP tools for game mode: the Pear server (stdio) plus optional external MCP servers."""
import json
import logging
import os
from pathlib import Path

from langchain_mcp_adapters.client import MultiServerMCPClient

log = logging.getLogger(__name__)
REPO_ROOT = Path(__file__).resolve().parents[3]


def connections(env=os.environ) -> dict:
    """Server name -> langchain-mcp-adapters connection. PEAR_MCP_COMMAND/PEAR_MCP_ARGS (JSON list) override the repo's Tools/pear-mcp; PEAR_EXTRA_MCP adds servers (JSON)."""
    args = json.loads(env["PEAR_MCP_ARGS"]) if env.get("PEAR_MCP_ARGS") else [str(REPO_ROOT / "Tools" / "pear-mcp" / "src" / "index.js")]
    pear_env = {k: env[k] for k in ("PEAR_CLOUD_URL", "PEAR_TOKEN", "PEAR_DEV_USER", "PEAR_DEV_PASSWORD", "PATH", "HOME") if env.get(k)}
    servers = {"pear": {"transport": "stdio", "command": env.get("PEAR_MCP_COMMAND", "node"), "args": args, "env": pear_env}}
    if env.get("PEAR_EXTRA_MCP"):
        servers.update(json.loads(env["PEAR_EXTRA_MCP"]))
    return servers


async def load_tools(env=os.environ) -> list:
    """LangChain tools from every configured server; [] (logged) when the servers cannot be reached."""
    try:
        return await MultiServerMCPClient(connections(env)).get_tools()
    except Exception as exc:  # noqa: BLE001 - a missing server must not break the agent
        log.warning("Pear MCP tools unavailable: %s", exc)
        return []
