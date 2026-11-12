-- Reconsider previously skipped messages after receipt extraction improves.
-- Existing email_items (including added/excluded) remain authoritative.
ALTER TABLE email_seen ADD COLUMN parser_version INTEGER NOT NULL DEFAULT 1;
