"""Write safety for the agent: manifest scopes, expected-revision writes, publish approval with a receipt."""
import hashlib
import json
import time
from pathlib import Path

from deepagents import FilesystemPermission
from deepagents.backends import FilesystemBackend
from deepagents.backends.protocol import EditResult, WriteResult
from langchain_core.tools import StructuredTool

# Manifest permission -> project paths it grants write access to. Unknown permissions grant nothing.
SCOPE_PATHS = {
    "filesystem:project_scripts": ["/scripts/**"],
    "filesystem:project_scene": ["/scene.json"],
    "filesystem:project_instructions": ["/instructions.json"],
}


def scoped_permissions(manifest_permissions) -> list:
    """Read everywhere; write only the declared scopes. First matching rule wins, so the denial comes last."""
    paths = [p for perm in manifest_permissions for p in SCOPE_PATHS.get(perm, [])]
    rules = [FilesystemPermission(operations=["read"], paths=["/**"])]
    if paths:
        rules.append(FilesystemPermission(operations=["write"], paths=paths))
    rules.append(FilesystemPermission(operations=["write"], paths=["/**"], mode="deny"))
    return rules


def manifest_permissions(plugin_dir: Path) -> list:
    return json.loads((plugin_dir / "pear-plugin.json").read_text(encoding="utf-8")).get("permissions", [])


def revision(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


class RevisionBackend(FilesystemBackend):
    """Rejects a write or edit of an existing file whose content changed since the agent last read or wrote it.
    The agent holds the revision from its last read; a file it never read cannot be overwritten blind."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.seen: dict[str, str] = {}

    def _disk(self, file_path: str) -> str | None:
        target = self._resolve_path(file_path)
        return target.read_text(encoding="utf-8", errors="replace") if target.is_file() else None

    def _stale(self, file_path: str) -> str | None:
        """An error message when the file exists and the agent's copy is missing or out of date."""
        current = self._disk(file_path)
        if current is None:
            return None
        now = revision(current)
        if self.seen.get(file_path) == now:
            return None
        return (f"Error: stale write rejected for {file_path}: it is at revision {now}, "
                f"you last saw {self.seen.get(file_path, 'nothing (never read)')}. Read the file again, then retry.")

    def _record(self, file_path: str) -> None:
        current = self._disk(file_path)
        if current is not None:
            self.seen[file_path] = revision(current)

    def read(self, file_path, *args, **kwargs):
        result = super().read(file_path, *args, **kwargs)
        self._record(file_path)
        return result

    async def aread(self, file_path, *args, **kwargs):
        result = await super().aread(file_path, *args, **kwargs)
        self._record(file_path)
        return result

    def write(self, file_path, content):
        if (error := self._stale(file_path)):
            return WriteResult(error=error)
        result = super().write(file_path, content)
        self._record(file_path)
        return result

    def edit(self, file_path, old_string, new_string, replace_all=False):
        if (error := self._stale(file_path)):
            return EditResult(error=error)
        result = super().edit(file_path, old_string, new_string, replace_all)
        self._record(file_path)
        return result

    async def awrite(self, file_path, content):
        return self.write(file_path, content)

    async def aedit(self, file_path, old_string, new_string, replace_all=False):
        return self.edit(file_path, old_string, new_string, replace_all)


def guard_publish(tools, approval):
    """Replace the `publish` tool with one that runs only for the exact {id, version} the user approved,
    and wraps the result in a receipt. `approval` is the prompt's `approvePublish` (None = not approved)."""
    out = []
    for tool in tools or []:
        if tool.name != "publish":
            out.append(tool)
            continue

        async def run(**args):
            ok = isinstance(approval, dict) and str(approval.get("id")) == str(args.get("id")) \
                and str(approval.get("version")) == str(args.get("version"))
            if not ok:
                return json.dumps({"published": False, "error": "publish needs the user's explicit approval for this game id and version; ask the user to approve it"})
            raw = await tool.ainvoke(args)
            return json.dumps({"published": True, "receipt": {"id": args.get("id"), "version": args.get("version"),
                                                              "approvedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                               "result": raw if isinstance(raw, str) else str(raw)})

        out.append(StructuredTool.from_function(coroutine=run, name="publish", description=tool.description + " Requires the user's approval.",
                                                args_schema=tool.args_schema))
    return out
