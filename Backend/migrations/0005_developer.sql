-- Developer accounts: a role and a password hash (argon2id PHC string) on accounts, and per-game
-- description and cover picture (kept in Postgres: the blob store is in-memory on the hosted box).
-- Accounts with role 'developer' are created only by `pear-backend create-developer`.

ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'developer'));
ALTER TABLE accounts ADD COLUMN password_hash TEXT NULL;

ALTER TABLE games ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE games ADD COLUMN cover BYTEA NULL;
ALTER TABLE games ADD COLUMN cover_type TEXT NULL;
