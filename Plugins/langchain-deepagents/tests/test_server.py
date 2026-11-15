import asyncio
import functools
import json
import urllib.request
from pathlib import Path

from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

import server
from scripted_model import LOG, ScriptedModel, call, say

ROOT = Path(__file__).resolve().parent.parent


def test_agent_can_write_anywhere_in_project_but_not_outside_it(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    model = ScriptedModel(replies=[
        call("write_file", "w1", file_path="/tools/hub.js", content="x"),
        call("write_file", "w2", file_path="/scripts/ok.js", content="y"),
        call("write_file", "w3", file_path="/../escape.js", content="z"),
        say("end"),
    ])
    agent = create_deep_agent(model=model, backend=FilesystemBackend(root_dir=project, virtual_mode=True),
                              permissions=server.PERMISSIONS)
    asyncio.run(agent.ainvoke({"messages": [{"role": "user", "content": "go"}]}))
    assert (project / "tools" / "hub.js").read_text() == "x"
    assert (project / "scripts" / "ok.js").read_text() == "y"
    assert not (tmp_path / "escape.js").exists()


CLIENT_JS = "export default script({});\n"
SERVER_JS = "export default serverScript({});\n"


def scripted_session() -> ScriptedModel:
    def todos(client, server_):
        return [{"content": "Write cube client script", "status": client},
                {"content": "Write tags server script", "status": server_}]

    return ScriptedModel(replies=[
        call("write_todos", "t1", todos=todos("pending", "pending")),
        call("task", "task-client", description="Write scripts/cube.client.js", subagent_type="client-js"),
        call("write_file", "w-client", file_path="/scripts/cube.client.js", content=CLIENT_JS),
        say("Wrote scripts/cube.client.js"),
        call("write_todos", "t2", todos=todos("completed", "in_progress")),
        call("task", "task-server", description="Write scripts/tags.server.js", subagent_type="server-js"),
        call("write_file", "w-server", file_path="/scripts/tags.server.js", content=SERVER_JS),
        say("Wrote scripts/tags.server.js"),
        call("write_todos", "t3", todos=todos("completed", "completed")),
        say("Wrote scripts/cube.client.js and scripts/tags.server.js."),
    ])


def test_health_and_scripted_prompt_over_websocket(tmp_path, monkeypatch):
    monkeypatch.setenv("PEAR_PROJECT_DIR", str(tmp_path))
    monkeypatch.setenv("PEAR_AGENT_MODEL", "anthropic:test")
    handler = functools.partial(server.handle_socket, model=scripted_session())

    async def scenario():
        async with serve(handler, "127.0.0.1", 0, process_request=server.handle_request) as srv:
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
    assert health_view == (200, {"status": "ok", "deepagents": "0.7.38", "model": "anthropic:test"}, "*")
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
    assert (tmp_path / ".pear" / "skills" / "pear-scripting" / "SKILL.md").is_file()


def test_second_prompt_on_the_same_project_waits_for_the_first(tmp_path):
    LOG.clear()
    first = ScriptedModel(replies=[say("one")], delay=0.3, name="one")
    second = ScriptedModel(replies=[say("two")], delay=0.3, name="two")

    async def collect(model):
        return [e async for e in server.run_prompt({"text": "go"}, tmp_path, model)]

    async def scenario():
        return await asyncio.gather(collect(first), collect(second))

    results = asyncio.run(scenario())
    assert [r[-1]["type"] for r in results] == ["done", "done"]
    # No overlap: each run's start is followed by its own end before the other starts.
    assert [entry.split(":")[1] for entry in LOG] == ["start", "end", "start", "end"]
    assert LOG[0].split(":")[0] != LOG[2].split(":")[0]


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
    assert choose({"PEAR_AGENT_MODEL": "openai:x", "ANTHROPIC_API_KEY": "k"}) == "openai:x"
    assert choose({"ANTHROPIC_API_KEY": "k", "OPENAI_API_KEY": "k"}) == "anthropic:claude-sonnet-5-5"
    assert choose({"OPENAI_API_KEY": "k", "GOOGLE_API_KEY": "k"}) == "openai:gpt-5.5"
    assert choose({"GOOGLE_API_KEY": "k"}) == "google_genai:gemini-2.5-pro"
    assert choose({"GEMINI_API_KEY": "k"}) == "google_genai:gemini-2.5-pro"
    assert choose({}) is None


def test_no_key_prompt_yields_one_error(tmp_path, monkeypatch):
    for name in ("PEAR_AGENT_MODEL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(name, raising=False)

    async def collect():
        return [e async for e in server.run_prompt({"text": "hi"}, tmp_path)]

    assert asyncio.run(collect()) == [{"type": "error", "message": server.NO_KEY_MESSAGE}]


def test_providers_resolve_and_subagents_inherit_the_main_model(monkeypatch):
    for name in ("PEAR_AGENT_MODEL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    assert all("model" not in spec for spec in server.SUBAGENTS)
    for env, spec in (("OPENAI_API_KEY", "openai"), ("GEMINI_API_KEY", "google_genai")):
        monkeypatch.setenv(env, "test-key")
        assert server.build_agent(Path(".")) is not None  # init_chat_model accepts the prefix with the installed package
        monkeypatch.delenv(env)


def test_health_reports_chosen_model_without_secrets(monkeypatch):
    monkeypatch.delenv("PEAR_AGENT_MODEL", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret")

    async def scenario():
        async with serve(server.handle_socket, "127.0.0.1", 0, process_request=server.handle_request) as srv:
            port = srv.sockets[0].getsockname()[1]
            health = await asyncio.to_thread(urllib.request.urlopen, f"http://127.0.0.1:{port}/health")
            return health.read().decode()

    body = asyncio.run(scenario())
    assert json.loads(body)["model"] == "openai:gpt-5.5" and "sk-secret" not in body


def test_extra_origin_from_env_is_accepted(monkeypatch):
    monkeypatch.setenv("PEAR_ALLOWED_ORIGINS", "http://localhost:5174, https://studio.example")

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


def test_sanitize_redacts_known_and_key_shaped_secrets():
    msg = "AuthenticationError: bad key sk-ant-abcdefghijkl1234 and AIzaSyA1234567890abcdefghijk, mine=hunter2hunter2"
    out = server.sanitize(msg, ["hunter2hunter2"])
    assert "sk-ant" not in out and "AIza" not in out and "hunter2" not in out and out.count("[redacted]") == 3


def test_slow_reader_does_not_hold_the_project_lock(tmp_path):
    async def scenario():
        slow = server.run_prompt({"text": "one"}, tmp_path, ScriptedModel(replies=[say("one")], name="one"))
        await slow.__anext__()  # the first reader stops reading here and never resumes
        fast = [e async for e in server.run_prompt({"text": "two"}, tmp_path, ScriptedModel(replies=[say("two")], name="two"))]
        await slow.aclose()
        return fast

    fast = asyncio.run(asyncio.wait_for(scenario(), 10))
    assert fast[-1]["type"] == "done"


def test_hosted_mode_requires_the_secret_and_never_uses_env_keys(tmp_path, monkeypatch):
    monkeypatch.setenv("PEAR_RUNTIME_SECRET", "s3cret")
    monkeypatch.setenv("PEAR_PROJECTS_ROOT", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-env-key-must-not-be-used")

    async def scenario():
        async with serve(server.handle_socket, "127.0.0.1", 0, process_request=server.handle_request) as srv:
            port = srv.sockets[0].getsockname()[1]
            url = f"ws://127.0.0.1:{port}/ws"
            out = {}
            for name, headers in (("none", {}), ("wrong", {"Authorization": "Bearer nope"})):
                try:
                    async with connect(url, additional_headers=headers):
                        out[name] = "open"
                except Exception as exc:  # noqa: BLE001
                    out[name] = str(exc)
            ok = {"Authorization": "Bearer s3cret", "X-Pear-Account": "acct-1", "X-Pear-Project": "p1"}
            async with connect(url, additional_headers=ok) as ws:
                await ws.send(json.dumps({"type": "prompt", "id": "p", "text": "hi"}))
                out["nokey"] = json.loads(await ws.recv())
            async with connect(url, additional_headers={**ok, "X-Pear-Project": "../x"}) as ws:
                out["badid"] = json.loads(await ws.recv())
            health = await asyncio.to_thread(urllib.request.urlopen, f"http://127.0.0.1:{port}/health")
            out["health"] = json.load(health)["model"]
            return out

    out = asyncio.run(scenario())
    assert "401" in out["none"] and "401" in out["wrong"]
    assert out["nokey"] == {"type": "error", "id": "p", "message": server.NO_KEY_MESSAGE}
    assert out["badid"]["type"] == "error"
    assert out["health"] == "per-account"
    assert (tmp_path / "acct-1" / "p1").is_dir()


def test_hosted_model_uses_the_header_key_for_its_provider():
    model, key = server.hosted_model({"X-Pear-Model-Provider": "openai", "X-Pear-Model-Key": "sk-header-key-123"})
    assert key == "sk-header-key-123" and model.openai_api_key.get_secret_value() == "sk-header-key-123"
    assert server.hosted_model({"X-Pear-Model-Provider": "nope", "X-Pear-Model-Key": "k"}) == (None, None)
    assert server.hosted_model({}) == (None, None)


def test_prepare_project_writes_the_scene_snapshot(tmp_path):
    server.prepare_project(tmp_path, {"scene": {"name": "s", "entities": [{"name": "Cube"}]}})
    assert json.loads((tmp_path / "scene.json").read_text(encoding="utf-8"))["entities"] == [{"name": "Cube"}]
    assert "/scene.json" in (tmp_path / "AGENTS.md").read_text(encoding="utf-8")
