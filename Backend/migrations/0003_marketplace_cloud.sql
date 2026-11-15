-- Marketplace on the hosted backend (Phase 10): versioned plugins with tarball bundles in object
-- storage (hash + signature + object key here), install records per account, per-account model keys.
-- Replaces the 0002 table: its JSON file-map bundles and install counter are dropped (re-run the seed job).

DROP TABLE IF EXISTS plugins;

CREATE TABLE plugins (
    id          TEXT        PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,64}$'),
    -- NULL = published by the seed job (no author account).
    author_id   UUID        REFERENCES accounts (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plugin_versions (
    seq         BIGSERIAL   PRIMARY KEY,
    plugin_id   TEXT        NOT NULL REFERENCES plugins (id) ON DELETE CASCADE,
    version     TEXT        NOT NULL,
    manifest    JSONB       NOT NULL,
    sha256      TEXT        NOT NULL,
    signature   TEXT        NOT NULL,
    object_key  TEXT        NOT NULL,
    size        BIGINT      NOT NULL,
    status      TEXT        NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plugin_id, version)
);

-- One row per (plugin, account); uninstall keeps the row with uninstalled_at set, so another device
-- can tell "uninstalled" from "never installed".
CREATE TABLE plugin_installs (
    plugin_id       TEXT        NOT NULL REFERENCES plugins (id) ON DELETE CASCADE,
    account_id      UUID        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    version         TEXT        NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    uninstalled_at  TIMESTAMPTZ,
    PRIMARY KEY (plugin_id, account_id)
);

-- Model API key per account, AES-256-GCM (nonce || ciphertext, base64) under PEAR_SECRET_KEY.
CREATE TABLE account_model_keys (
    account_id  UUID        PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    provider    TEXT        NOT NULL,
    ciphertext  TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
