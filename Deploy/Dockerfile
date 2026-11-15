# Pear backend + Studio. Build context is the repo root (compose sets it): the Studio and the
# backend both read shared files outside their folders (prelude.js, Schema, Games, brand kit).
#   docker build -f Deploy/Dockerfile -t pear .

FROM node:22-bookworm-slim AS studio
WORKDIR /repo
COPY . .
WORKDIR /repo/Web
RUN npm ci && npm run build

FROM rust:1-bookworm AS backend
WORKDIR /repo
COPY . .
WORKDIR /repo/Backend
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /repo/Backend/target/release/pear-backend /app/pear-backend
COPY --from=studio /repo/Web/studio/dist /app/studio
# /download is a directory in the Studio build, served by the backend's static fallback.
COPY Deploy/download.html /app/studio/download/index.html
COPY Web/studio/src/studio-tokens.css /app/studio/download/tokens.css
# Plugin sources for the marketplace seed job: docker compose run --rm backend /app/pear-backend seed /app/Plugins
COPY Plugins /app/Plugins
ARG PEAR_BUILD=dev
ENV PORT=8080 PEAR_STUDIO_DIR=/app/studio PEAR_BUILD=$PEAR_BUILD
EXPOSE 8080
CMD ["/app/pear-backend"]
