"""Omni Deep Agents runtime: /health over HTTP and /ws for panel prompts (websockets only).

Live model: OMNI_AGENT_MODEL ("provider:model") or the first key set of ANTHROPIC_API_KEY, OPENAI_API_KEY,
GOOGLE_API_KEY/GEMINI_API_KEY. Extra panel origins: OMNI_ALLOWED_ORIGINS (comma-separated).

Hosted mode (OMNI_RUNTIME_SECRET set, run beside the Omni backend): /ws needs
`Authorization: Bearer $OMNI_RUNTIME_SECRET` (the backend's /agent/ws proxy sends it), the project dir
is OMNI_PROJECTS_ROOT/<X-Omni-Account>/<X-Omni-Project>, and the model key comes only from the
X-Omni-Model-Provider / X-Omni-Model-Key headers (that account's key): env keys are never used.
Bind address: OMNI_RUNTIME_HOST (default 127.0.0.1).
"""
import asyncio
import hmac
import json
import os
import re
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


# Default "provider:model" per key provider (the backend's provider names).
DEFAULT_MODELS = {
    "anthropic": "anthropic:claude-sonnet-5-5",
    "openai": "openai:gpt-5.5",
    # shortcut: unverified model id, override with OMNI_AGENT_MODEL
    "google": "google_genai:gemini-2.5-pro",
}


def choose_model(env) -> str | None:
    """The "provider:model" to use, or None when no key is set. OMNI_AGENT_MODEL wins."""
    if env.get("OMNI_AGENT_MODEL"):
        return env["OMNI_AGENT_MODEL"]
    if env.get("ANTHROPIC_API_KEY"):
        return DEFAULT_MODELS["anthropic"]
    if env.get("OPENAI_API_KEY"):
        return DEFAULT_MODELS["openai"]
    if env.get("GOOGLE_API_KEY") or env.get("GEMINI_API_KEY"):
        return DEFAULT_MODELS["google"]
    return None


# Key-shaped tokens a provider error may echo back (Anthropic, OpenAI, Google), plus the exact keys in use.
KEY_PATTERN = re.compile(r"(sk-[A-Za-z0-9_\-]{8,}|AIza[0-9A-Za-z_\-]{20,})")


def sanitize(message: str, secrets=()) -> str:
    """Error text safe to send to the panel: known keys and key-shaped tokens replaced."""
    for secret in secrets:
        if secret:
            message = message.replace(secret, "[redacted]")
    return KEY_PATTERN.sub("[redacted]", message)


def env_secrets(env) -> list[str]:
    return [env[k] for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY") if env.get(k)]

PERMISSIONS = [
    FilesystemPermission(operations=["write"], paths=["/scripts/**"]),
    # The scene: written from the panel's snapshot before each prompt; the panel validates edits before applying them.
    FilesystemPermission(operations=["write"], paths=["/scene.json"]),
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
    """Copy the skills into the project, write scene.json and render AGENTS.md from the prompt's project snapshot."""
    shutil.copytree(PLUGIN_DIR / "skills", project_dir / ".omni" / "skills", dirs_exist_ok=True)
    (project_dir / "scene.json").write_text(json.dumps(snapshot.get("scene") or {}, indent=2), encoding="utf-8")
    dump = lambda key: json.dumps(snapshot.get(key), indent=2)  # noqa: E731
    template = Template((PLUGIN_DIR / "AGENTS.md.tmpl").read_text(encoding="utf-8"))
    text = template.safe_substitute(scene=dump("scene"), scripts=dump("scripts"), peripherals=dump("peripherals"))
    (project_dir / "AGENTS.md").write_text(text, encoding="utf-8")


PROJECT_LOCKS: dict[Path, asyncio.Lock] = {}


async def run_prompt(message: dict, project_dir: Path, model=None, env_model=True, secrets=()):
    """Yield the panel events (without ids) for one prompt, ending with done or error.

    Prompts for the same project dir run one at a time: a second prompt waits for the first to finish.
    The agent runs in its own task and queues its events, so the project lock is released when the
    agent finishes even if the socket reading the events is slow. `env_model=False` (hosted mode)
    never falls back to env keys; `secrets` are redacted from error text.
    """
    if model is None and (not env_model or choose_model(os.environ) is None):
        yield {"type": "error", "message": NO_KEY_MESSAGE}
        return
    secrets = [*secrets, *env_secrets(os.environ)]
    queue: asyncio.Queue = asyncio.Queue()

    async def produce():
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
                        queue.put_nowait(event)
            queue.put_nowait({"type": "done", "summary": state["summary"]})
        except Exception as exc:  # noqa: BLE001 - any agent failure must reach the panel
            queue.put_nowait({"type": "error", "message": sanitize(f"{type(exc).__name__}: {exc}", secrets)})
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(produce())
    try:
        while (event := await queue.get()) is not None:
            yield event
    finally:
        if not task.done():
            task.cancel()  # the reader went away: stop the agent and free the lock


ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost",
                   "http://tauri.localhost", "https://tauri.localhost"}


def hosted() -> bool:
    return bool(os.environ.get("OMNI_RUNTIME_SECRET"))


SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def hosted_project_dir(headers) -> Path:
    """OMNI_PROJECTS_ROOT/<account>/<project>; ValueError for ids that are not plain slugs."""
    account, project = headers.get("X-Omni-Account", ""), headers.get("X-Omni-Project", "")
    if not SAFE_ID.match(account) or not SAFE_ID.match(project):
        raise ValueError("bad account or project id")
    root = Path(os.environ.get("OMNI_PROJECTS_ROOT", "projects")).resolve()
    path = root / account / project
    path.mkdir(parents=True, exist_ok=True)
    return path


def hosted_model(headers):
    """(chat model, key) from the account's key headers, or (None, None) when it sent none."""
    provider, key = headers.get("X-Omni-Model-Provider"), headers.get("X-Omni-Model-Key")
    if not key or provider not in DEFAULT_MODELS:
        return None, None
    return init_chat_model(DEFAULT_MODELS[provider], api_key=key), key


def handle_request(connection, request):
    if request.path == "/health":
        model = "per-account" if hosted() else choose_model(os.environ)
        response = connection.respond(HTTPStatus.OK, json.dumps({"status": "ok", "deepagents": version("deepagents"), "model": model}))
        response.headers["Content-Type"] = "application/json"
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response
    if request.path != "/ws":
        return connection.respond(HTTPStatus.NOT_FOUND, "not found\n")
    if hosted():
        given = request.headers.get("Authorization", "")
        if not hmac.compare_digest(given.encode(), f"Bearer {os.environ['OMNI_RUNTIME_SECRET']}".encode()):
            return connection.respond(HTTPStatus.UNAUTHORIZED, "unauthorized\n")
    origin = request.headers.get("Origin")
    extra = {o.strip() for o in os.environ.get("OMNI_ALLOWED_ORIGINS", "").split(",") if o.strip()}
    if origin is not None and origin not in ALLOWED_ORIGINS | extra:
        return connection.respond(HTTPStatus.FORBIDDEN, "origin not allowed\n")
    return None


async def handle_socket(websocket, model=None):
    secrets, env_model = (), True
    if hosted():
        env_model = False
        try:
            hosted_dir = hosted_project_dir(websocket.request.headers)
            if model is None:
                model, key = hosted_model(websocket.request.headers)
                secrets = (key,) if key else ()
        except Exception as exc:  # noqa: BLE001 - bad ids or an unusable key: tell the panel, then close
            await websocket.send(json.dumps({"type": "error", "id": None, "message": sanitize(str(exc), secrets)}))
            return
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
            project_dir = hosted_dir if hosted() else Path(os.environ.get("OMNI_PROJECT_DIR", ".")).resolve()
            async for event in run_prompt(message, project_dir, model, env_model, secrets):
                await websocket.send(json.dumps({**event, "id": prompt_id}))
    except ConnectionClosed:
        pass


async def main() -> None:
    port = int(os.environ.get("OMNI_PLUGIN_PORT", "9410"))
    host = os.environ.get("OMNI_RUNTIME_HOST", "127.0.0.1")
    async with serve(handle_socket, host, port, process_request=handle_request, max_size=2**22):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
