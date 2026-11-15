# Hosted Deep Agents runtime (Phase 10.6): the marketplace plugin's Python runtime, reachable only on the
# compose network through the backend's /agent/ws proxy. Hosted mode = PEAR_RUNTIME_SECRET set (see
# Plugins/langchain-deepagents/runtime/server.py). Build context is the repo root.
FROM ghcr.io/astral-sh/uv:0.9.5-python3.12-bookworm-slim
WORKDIR /app
COPY Plugins/langchain-deepagents /app
RUN uv sync --frozen --no-dev
ENV PEAR_RUNTIME_HOST=0.0.0.0 PEAR_PLUGIN_PORT=9410 PEAR_PROJECTS_ROOT=/data/projects
EXPOSE 9410
CMD ["uv", "run", "--no-dev", "python", "runtime/server.py"]
