-- Omni backend schema v1 (overview.md Module 11): accounts, games, published game versions.
-- Game content only; sensor data (USIS) and output commands never reach the cloud.
-- Game files are stored in Postgres (TigerData) for now; object storage is not decided.

CREATE TABLE accounts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Sign-in method not decided (Sign in with Apple preferred): provider + subject identify the login.
    provider      TEXT        NOT NULL,
    subject       TEXT        NOT NULL,
    display_name  TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, subject)
);

CREATE TABLE games (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    title       TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX games_owner_id_idx ON games (owner_id);

CREATE TABLE game_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id         UUID        NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    version         INTEGER     NOT NULL CHECK (version >= 1),
    -- SceneDescription JSON.
    scene           JSONB       NOT NULL,
    -- Script sources keyed by script name: { "enemy": "export default script({...})" }.
    client_scripts  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    server_scripts  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- Asset files keyed by name; shape of the stored value is not decided.
    assets          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- Metadata (title, author, version, ...) and the declared run mode.
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    run_mode        TEXT        NOT NULL DEFAULT 'screen' CHECK (run_mode IN ('screen', 'device')),
    published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (game_id, version)
);
