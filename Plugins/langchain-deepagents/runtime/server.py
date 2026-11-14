"""Omni Deep Agents runtime: /health over HTTP and /ws for panel prompts (websockets only).

Live model: OMNI_AGENT_MODEL ("provider:model") or the first key set of ANTHROPIC_API_KEY, OPENAI_API_KEY,
GOOGLE_API_KEY/GEMINI_API_KEY. Extra panel origins: OMNI_ALLOWED_ORIGINS (comma-separated).
"""
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
from langchain.chat_models import init_chat_model
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from translate import new_state, translate

PLUGIN_DIR = Path(__file__).resolve().parent.parent
NO_KEY_MESSAGE = "No model API key: set ANTHROPIC_API_KEY, OPENAI_API_KEY or GOOGLE_API_KEY."


def choose_model(env) -> str | None:
    """The "provider:model" to use, or None when no key is set. OMNI_AGENT_MODEL wins."""
    if env.get("OMNI_AGENT_MODEL"):
        return env["OMNI_AGENT_MODEL"]
    if env.get("ANTHROPIC_API_KEY"):
        return "anthropic:claude-sonnet-5-5"
    if env.get("OPENAI_API_KEY"):
        return "openai:gpt-5.5"
    if env.get("GOOGLE_API_KEY") or env.get("GEMINI_API_KEY"):
        # shortcut: unverified model id, override with OMNI_AGENT_MODEL
        return "google_genai:gemini-2.5-pro"
    return None

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


def build_agent(project_dir: Path, model=None):
    """The deep agent for one project. `model` (a chat model instance) is injected by tests; otherwise the env picks it."""
    if model is None:
        model = choose_model(os.environ)
        if model.startswith("google_genai:") and not os.environ.get("GOOGLE_API_KEY") and os.environ.get("GEMINI_API_KEY"):
            model = init_chat_model(model, api_key=os.environ["GEMINI_API_KEY"])
    # The subagents specs carry no model, so they inherit this one.
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


PROJECT_LOCKS: dict[Path, asyncio.Lock] = {}


async def run_prompt(message: dict, project_dir: Path, model=None):
    """Yield the panel events (without ids) for one prompt, ending with done or error.

    Prompts for the same project dir run one at a time: a second prompt waits for the first to finish.
    """
    if model is None and choose_model(os.environ) is None:
        yield {"type": "error", "message": NO_KEY_MESSAGE}
        return
    try:
        async with PROJECT_LOCKS.setdefault(project_dir, asyncio.Lock()):
            prepare_project(project_dir, message.get("project") or {})
            agent = build_agent(project_dir, model)
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


ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost",
                   "http://tauri.localhost", "https://tauri.localhost"}


def handle_request(connection, request):
    if request.path == "/health":
        model = choose_model(os.environ)
        response = connection.respond(HTTPStatus.OK, json.dumps({"status": "ok", "deepagents": version("deepagents"), "model": model}))
        response.headers["Content-Type"] = "application/json"
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response
    if request.path != "/ws":
        return connection.respond(HTTPStatus.NOT_FOUND, "not found\n")
    origin = request.headers.get("Origin")
    extra = {o.strip() for o in os.environ.get("OMNI_ALLOWED_ORIGINS", "").split(",") if o.strip()}
    if origin is not None and origin not in ALLOWED_ORIGINS | extra:
        return connection.respond(HTTPStatus.FORBIDDEN, "origin not allowed\n")
    return None


async def handle_socket(websocket, model=None):
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
            async for event in run_prompt(message, project_dir, model):
                await websocket.send(json.dumps({**event, "id": prompt_id}))
    except ConnectionClosed:
        pass


async def main() -> None:
    port = int(os.environ.get("OMNI_PLUGIN_PORT", "9410"))
    async with serve(handle_socket, "127.0.0.1", port, process_request=handle_request, max_size=2**22):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
