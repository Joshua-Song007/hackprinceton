-- Game listing (Phase 13.9): only games the owner lists appear in the player catalog. The description
-- and cover already live on games (0005); this adds the listing flag, tags and release notes.
-- Games that exist when this runs were all visible before, so they stay listed; new games default to unlisted.

ALTER TABLE games ADD COLUMN listed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE games ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE games ADD COLUMN release_notes TEXT NOT NULL DEFAULT '';
UPDATE games SET listed = true;
