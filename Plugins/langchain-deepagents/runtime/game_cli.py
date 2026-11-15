"""Run one game-mode prompt to completion and print the agent's summary (demo without Studio).

Usage: uv run python runtime/game_cli.py "make a two-player tag game"
Model from the env (see server.py); Pear MCP from PEAR_CLOUD_URL/PEAR_TOKEN (see pear_tools.py). Scratch files go to PEAR_GAME_DIR (default: a temp dir).
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

import pear_tools
import server


async def main(prompt: str) -> str:
    project_dir = Path(os.environ.get("PEAR_GAME_DIR") or tempfile.mkdtemp(prefix="pear-game-"))
    project_dir.mkdir(parents=True, exist_ok=True)
    server.prepare_project(project_dir, {}, "game")
    tools = await pear_tools.load_tools()
    print(f"{len(tools)} MCP tools: {', '.join(t.name for t in tools)}", file=sys.stderr)
    agent = server.build_agent(project_dir, None, "game", tools)
    result = await agent.ainvoke({"messages": [{"role": "user", "content": prompt}]}, {"recursion_limit": 200})
    content = result["messages"][-1].content
    return content if isinstance(content, str) else "".join(c.get("text", "") for c in content if isinstance(c, dict))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    if server.choose_model(os.environ) is None:
        sys.exit(server.NO_KEY_MESSAGE)
    print(asyncio.run(main(" ".join(sys.argv[1:]))))
