-- Plugin marketplace registry: one row per plugin; bundle is {"files":{"relpath":"utf8 content"}}.
-- Bundles live in Postgres for now; object storage is a later step.

CREATE TABLE plugins (
    id           TEXT        PRIMARY KEY,
    name         TEXT        NOT NULL,
    version      TEXT        NOT NULL,
    author       TEXT        NOT NULL,
    category     TEXT        NOT NULL,
    description  TEXT        NOT NULL,
    manifest     JSONB       NOT NULL,
    bundle       JSONB       NOT NULL,
    installs     BIGINT      NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
