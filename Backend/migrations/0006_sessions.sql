-- Sign-in sessions that survive server restarts. Only sha256(token) hex is stored, never the raw token.
-- Lifetime 30 days, sliding (expires_at is pushed out at most once an hour); deleted with the account.

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account_id_idx ON sessions (account_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
