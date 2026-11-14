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
    assert health_view == (200, {"status": "ok", "deepagents": "0.7.38", "model": "fake"}, "*")
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


def test_fake_scripts_start_with_export_default():
    assert server.CUBE_CLIENT_JS.startswith("export default")
    assert server.TAGS_SERVER_JS.startswith("export default")


def test_foreign_origin_websocket_is_rejected():
    async def scenario():
        async with serve(server.handle_socket, "127.0.0.1", 0, process_request=server.handle_request) as srv:
            port = srv.sockets[0].getsockname()[1]
            try:
                async with connect(f"ws://127.0.0.1:{port}/ws", origin="http://evil.example"):
                    return None
            except Exception as exc:  # noqa: BLE001
                return exc
            
    exc = asyncio.run(scenario())
    assert exc is not None and "403" in str(exc)


def test_choose_model_env_override_then_key_order():
    choose = server.choose_model
    assert choose({"OMNI_AGENT_MODEL": "openai:x", "ANTHROPIC_API_KEY": "k"}) == "openai:x"
    assert choose({"ANTHROPIC_API_KEY": "k", "OPENAI_API_KEY": "k"}) == "anthropic:claude-sonnet-5-5"
    assert choose({"OPENAI_API_KEY": "k", "GOOGLE_API_KEY": "k"}) == "openai:gpt-5.5"
    assert choose({"GOOGLE_API_KEY": "k"}) == "google_genai:gemini-2.5-pro"
    assert choose({"GEMINI_API_KEY": "k"}) == "google_genai:gemini-2.5-pro"
    assert choose({}) is None


def test_no_key_prompt_yields_one_error(tmp_path, monkeypatch):
    for name in ("OMNI_AGENT_FAKE", "OMNI_AGENT_MODEL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(name, raising=False)

    async def collect():
        return [e async for e in server.run_prompt({"text": "hi"}, tmp_path)]

    assert asyncio.run(collect()) == [{"type": "error", "message": server.NO_KEY_MESSAGE}]


def test_providers_resolve_and_subagents_inherit_the_main_model(monkeypatch):
    for name in ("OMNI_AGENT_FAKE", "OMNI_AGENT_MODEL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    assert all("model" not in spec for spec in server.SUBAGENTS)
    for env, spec in (("OPENAI_API_KEY", "openai"), ("GEMINI_API_KEY", "google_genai")):
        monkeypatch.setenv(env, "test-key")
        assert server.build_agent(Path(".")) is not None  # init_chat_model accepts the prefix with the installed package
        monkeypatch.delenv(env)


def test_health_reports_chosen_model_without_secrets(monkeypatch):
    monkeypatch.delenv("OMNI_AGENT_FAKE", raising=False)
    monkeypatch.delenv("OMNI_AGENT_MODEL", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret")

    async def scenario():
        async with serve(server.handle_socket, "127.0.0.1", 0, process_request=server.handle_request) as srv:
            port = srv.sockets[0].getsockname()[1]
            health = await asyncio.to_thread(urllib.request.urlopen, f"http://127.0.0.1:{port}/health")
            return health.read().decode()

    body = asyncio.run(scenario())
    assert json.loads(body)["model"] == "openai:gpt-5.5" and "sk-secret" not in body


def test_extra_origin_from_env_is_accepted(monkeypatch):
    monkeypatch.setenv("OMNI_ALLOWED_ORIGINS", "http://localhost:5174, https://studio.example")

    async def scenario(origin):
        async with serve(server.handle_socket, "127.0.0.1", 0, process_request=server.handle_request) as srv:
            port = srv.sockets[0].getsockname()[1]
            try:
                async with connect(f"ws://127.0.0.1:{port}/ws", origin=origin):
                    return None
            except Exception as exc:  # noqa: BLE001
                return exc

    assert asyncio.run(scenario("https://studio.example")) is None
    assert asyncio.run(scenario("http://localhost:5174")) is None
    assert "403" in str(asyncio.run(scenario("http://evil.example")))
