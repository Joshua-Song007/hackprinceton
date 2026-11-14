import asyncio
import json
import urllib.request
from pathlib import Path

from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

import server

ROOT = Path(__file__).resolve().parent.parent


def test_write_outside_scripts_is_denied(tmp_path):
    model = server.ReplayModel(replies=[
        server._call("write_file", "w1", file_path="/escape.js", content="x"),
        server._call("write_file", "w2", file_path="/scripts/ok.js", content="y"),
        server.AIMessage(content="end"),
    ])
    agent = create_deep_agent(model=model, backend=FilesystemBackend(root_dir=tmp_path, virtual_mode=True),
                              permissions=server.PERMISSIONS)
    result = asyncio.run(agent.ainvoke({"messages": [{"role": "user", "content": "go"}]}))
    assert not (tmp_path / "escape.js").exists()
    assert (tmp_path / "scripts" / "ok.js").read_text() == "y"
    assert "permission denied" in result["messages"][2].content


def test_health_and_fake_prompt_over_websocket(tmp_path, monkeypatch):
    monkeypatch.setenv("OMNI_AGENT_FAKE", "1")
    monkeypatch.setenv("OMNI_PROJECT_DIR", str(tmp_path))

    async def scenario():
        async with serve(server.handle_socket, "127.0.0.1", 0, process_request=server.handle_request) as srv:
            port = srv.sockets[0].getsockname()[1]
            health = await asyncio.to_thread(urllib.request.urlopen, f"http://127.0.0.1:{port}/health")
            health_view = (health.status, json.load(health), health.headers["Access-Control-Allow-Origin"])
            events = []
            async with connect(f"ws://127.0.0.1:{port}/ws") as ws:
                await ws.send(json.dumps({"type": "prompt", "id": "p1", "text": "make a cube",
                                          "project": {"scene": {"name": "s"}, "scripts": [], "peripherals": []}}))
                while not events or events[-1]["type"] not in ("done", "error"):
                    events.append(json.loads(await ws.recv()))
            return health_view, events

    health_view, events = asyncio.run(scenario())
    assert health_view == (200, {"status": "ok", "deepagents": "0.7.38"}, "*")
    assert {e["id"] for e in events} == {"p1"}
    assert events[-1]["type"] == "done"
    kinds = {e["type"] for e in events}
    assert {"todos", "subagent_status", "file_written"} <= kinds
    names_states = {(e["name"], e["state"]) for e in events if e["type"] == "subagent_status"}
    assert {(n, s) for n in ("client-js", "server-js") for s in ("started", "running", "done")} <= names_states
    written = [e for e in events if e["type"] == "file_written"]
    assert [e["path"] for e in written] == ["scripts/cube.client.js", "scripts/tags.server.js"]
    for e in written:
        assert (tmp_path / e["path"]).read_text(encoding="utf-8") == e["content"]
    assert '"name": "s"' in (tmp_path / "AGENTS.md").read_text(encoding="utf-8")
    assert (tmp_path / ".omni" / "skills" / "omni-scripting" / "SKILL.md").is_file()
