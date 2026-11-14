"""Omni Deep Agents runtime: /health over HTTP and /ws for panel prompts (websockets only)."""
import asyncio
import json
import os
import shutil
from http import HTTPStatus
from importlib.metadata import version
from pathlib import Path
from string import Template

from deepagents import FilesystemPermission, create_deep_agent
from deepagents.backends import FilesystemBackend
from langchain.agents.middleware import TodoListMiddleware
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from translate import new_state, translate

PLUGIN_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = "anthropic:claude-sonnet-5-5"

PERMISSIONS = [
    FilesystemPermission(operations=["write"], paths=["/scripts/**"]),
    FilesystemPermission(operations=["write"], paths=["/**"], mode="deny"),
]

SUBAGENTS = [
    {
        "name": "client-js",
        "description": "Writes Omni client scripts (scripts/<name>.client.js) that react to input and fire RemoteEvents.",
        "system_prompt": "You write Omni client scripts using script({...}). Follow the omni-scripting skill. "
        "Write only scripts/<name>.client.js files.",
    },
    {
        "name": "server-js",
        "description": "Writes Omni server scripts (scripts/<name>.server.js) that handle RemoteEvents and keep room state.",
        "system_prompt": "You write Omni server scripts using serverScript({...}). Follow the omni-scripting skill. "
        "Write only scripts/<name>.server.js files.",
    },
]

CUBE_CLIENT_JS = """// Cube pulse (client script): looking at the cube pulses it and tags the look for the server.
// [provisional] self.scale, self.name and ctx.haptic follow the Flagship scripts; prelude.js does not define self/ctx shapes.
export default (function () {
  return script({
    onLookAt(self, ctx) {
      self.scale = 1.25;
      ctx.haptic("tick", 0.4);
      ctx.remote.fire("tag", { entity: self.name, tag: "looked" });
    },

    // The server confirmed the tag: end the pulse.
    onRemote(self, ctx, name, data) {
      if (name === "tagCount" && data.entity === self.name) self.scale = 1;
    },
  });
})();
"""

TAGS_SERVER_JS = """// Tag counter (server script): counts each tag per player and confirms to everyone.
export default (function () {
  function init(ctx) {
    if (!ctx.state.tags) ctx.state.tags = {};
  }

  return serverScript({
    onPlayerJoin(ctx, player) {
      init(ctx);
      ctx.state.tags[player.id] = {};
    },

    onPlayerLeave(ctx, player) {
      init(ctx);
      delete ctx.state.tags[player.id];
    },

    onRemote(ctx, player, name, data) {
      init(ctx);
      if (name !== "tag") return;
      const mine = ctx.state.tags[player.id] || (ctx.state.tags[player.id] = {});
      mine[data.tag] = (mine[data.tag] || 0) + 1;
      ctx.remote.fireAll("tagCount", { entity: data.entity, player: player.id, tag: data.tag, count: mine[data.tag] });
    },
  });
})();
"""


class ReplayModel(BaseChatModel):
    """Deterministic stand-in for the LLM (OMNI_AGENT_FAKE=1): replays a fixed list of replies."""

    replies: list[AIMessage]
    next_index: int = 0

    @property
    def _llm_type(self) -> str:
        return "omni-replay"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        reply = self.replies[self.next_index]
        self.next_index += 1
        return ChatResult(generations=[ChatGeneration(message=reply)])


def _call(name: str, call_id: str, **args) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


def fake_model() -> ReplayModel:
    def todos(client, server):
        return [{"content": "Write cube client script", "status": client},
                {"content": "Write tags server script", "status": server}]

    return ReplayModel(replies=[
        _call("write_todos", "t1", todos=todos("pending", "pending")),
        _call("task", "task-client", description="Write scripts/cube.client.js", subagent_type="client-js"),
        _call("write_file", "w-client", file_path="/scripts/cube.client.js", content=CUBE_CLIENT_JS),
        AIMessage(content="Wrote scripts/cube.client.js"),
        _call("write_todos", "t2", todos=todos("completed", "in_progress")),
        _call("task", "task-server", description="Write scripts/tags.server.js", subagent_type="server-js"),
        _call("write_file", "w-server", file_path="/scripts/tags.server.js", content=TAGS_SERVER_JS),
        AIMessage(content="Wrote scripts/tags.server.js"),
        _call("write_todos", "t3", todos=todos("completed", "completed")),
        AIMessage(content="Wrote scripts/cube.client.js and scripts/tags.server.js."),
    ])


def build_agent(project_dir: Path):
    model = fake_model() if os.environ.get("OMNI_AGENT_FAKE") == "1" else os.environ.get("OMNI_AGENT_MODEL", DEFAULT_MODEL)
    return create_deep_agent(
        model=model,
        skills=["/.omni/skills/"],
        memory=["/AGENTS.md"],
        middleware=[TodoListMiddleware()],
        subagents=SUBAGENTS,
        backend=FilesystemBackend(root_dir=project_dir, virtual_mode=True),
        permissions=PERMISSIONS,
    )


def prepare_project(project_dir: Path, snapshot: dict) -> None:
    """Copy the skills into the project and render AGENTS.md from the prompt's project snapshot."""
    shutil.copytree(PLUGIN_DIR / "skills", project_dir / ".omni" / "skills", dirs_exist_ok=True)
    dump = lambda key: json.dumps(snapshot.get(key), indent=2)  # noqa: E731
    template = Template((PLUGIN_DIR / "AGENTS.md.tmpl").read_text(encoding="utf-8"))
    text = template.safe_substitute(scene=dump("scene"), scripts=dump("scripts"), peripherals=dump("peripherals"))
    (project_dir / "AGENTS.md").write_text(text, encoding="utf-8")


async def run_prompt(message: dict, project_dir: Path):
    """Yield the panel events (without ids) for one prompt, ending with done or error."""
    try:
        prepare_project(project_dir, message.get("project") or {})
        agent = build_agent(project_dir)
        state = new_state()
        async for chunk in agent.astream(
            {"messages": [{"role": "user", "content": message["text"]}]},
            stream_mode=["updates", "messages"],
            subgraphs=True,
        ):
            for event in translate(chunk, project_dir, state):
                yield event
        yield {"type": "done", "summary": state["summary"]}
    except Exception as exc:  # noqa: BLE001 - any agent failure must reach the panel
        yield {"type": "error", "message": f"{type(exc).__name__}: {exc}"}


def handle_request(connection, request):
    if request.path == "/health":
        response = connection.respond(HTTPStatus.OK, json.dumps({"status": "ok", "deepagents": version("deepagents")}))
        response.headers["Content-Type"] = "application/json"
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response
    if request.path != "/ws":
        return connection.respond(HTTPStatus.NOT_FOUND, "not found\n")
    return None


async def handle_socket(websocket):
    try:
        async for raw in websocket:
            try:
                message = json.loads(raw)
                prompt_id, is_prompt = message.get("id"), message.get("type") == "prompt"
            except (ValueError, AttributeError):
                message, prompt_id, is_prompt = {}, None, False
            if not is_prompt or not isinstance(message.get("text"), str):
                await websocket.send(json.dumps({"type": "error", "id": prompt_id, "message": "expected a prompt message"}))
                continue
            project_dir = Path(os.environ.get("OMNI_PROJECT_DIR", ".")).resolve()
            async for event in run_prompt(message, project_dir):
                await websocket.send(json.dumps({**event, "id": prompt_id}))
    except ConnectionClosed:
        pass


async def main() -> None:
    port = int(os.environ.get("OMNI_PLUGIN_PORT", "9410"))
    async with serve(handle_socket, "127.0.0.1", port, process_request=handle_request, max_size=2**22):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
