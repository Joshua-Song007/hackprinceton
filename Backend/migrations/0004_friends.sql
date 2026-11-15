-- Friends: one row per pair. pending = requester asked, addressee has not answered; accepted = mutual.
-- The friend code is not stored: it is the first 6 hex characters of the account id (db.rs friend_code).

CREATE TABLE friendships (
    requester_id  UUID        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    addressee_id  UUID        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
);

-- At most one row per unordered pair: A->B and B->A cannot both exist.
CREATE UNIQUE INDEX friendships_pair_idx ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX friendships_addressee_idx ON friendships (addressee_id);
