import asyncio

from langchain_core.tools import tool

import pear_tools
import game_cli
import server
from scripted_model import ScriptedModel, say


@tool
def kit_reference() -> str:
    """Pear kit reference."""
    return "ref"


def test_game_mode_wires_prompt_and_tools(tmp_path):
    seen = []

    class Spy(ScriptedModel):
        def bind_tools(self, tools, **kwargs):
            seen.extend(t.name if hasattr(t, "name") else t["name"] for t in tools)
            return self

        def _generate(self, messages, *a, **k):
            seen.append(str(messages[0].content))
            return super()._generate(messages, *a, **k)

    agent = server.build_agent(tmp_path, Spy(replies=[say("done")]), "game", [kit_reference])
    asyncio.run(agent.ainvoke({"messages": [{"role": "user", "content": "make a game"}]}))
    assert "kit_reference" in seen
    assert any("Call kit_reference first" in s for s in seen)
    assert any("Never call publish" in s for s in seen)
    assert "game" in server.MODES


def test_load_tools_returns_empty_when_server_missing(monkeypatch):
    monkeypatch.setenv("PEAR_MCP_COMMAND", "/nonexistent/node")
    assert asyncio.run(pear_tools.load_tools()) == []


def test_game_cli_prints_the_final_summary(tmp_path, monkeypatch):
    async def no_tools():
        return []

    monkeypatch.setattr(pear_tools, "load_tools", no_tools)
    monkeypatch.setattr(server, "resolve_model", lambda model=None: ScriptedModel(replies=[say("all expects pass, v1")]))
    monkeypatch.setenv("PEAR_GAME_DIR", str(tmp_path))
    assert asyncio.run(game_cli.main("make a game")) == "all expects pass, v1"
