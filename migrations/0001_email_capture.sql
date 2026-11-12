PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS email_oauth_states (
  state_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL, timezone TEXT NOT NULL, hour INTEGER NOT NULL,
  minute INTEGER NOT NULL, currency TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_accounts (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, mailbox_sub TEXT NOT NULL, email TEXT NOT NULL,
  refresh_token TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  timezone TEXT NOT NULL, hour INTEGER NOT NULL, minute INTEGER NOT NULL, currency TEXT NOT NULL,
  next_scan INTEGER NOT NULL, last_scan INTEGER NOT NULL DEFAULT 0,
  scan_start INTEGER, page_token TEXT, last_error TEXT,
  lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  UNIQUE(owner, mailbox_sub)
);
CREATE INDEX IF NOT EXISTS email_due ON email_accounts(enabled,next_scan);
CREATE TABLE IF NOT EXISTS email_items (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, account_id TEXT NOT NULL,
  message_id TEXT NOT NULL, proposal TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id,message_id)
);
CREATE INDEX IF NOT EXISTS email_inbox ON email_items(owner,status,created_at);
CREATE TABLE IF NOT EXISTS email_seen (
  account_id TEXT NOT NULL, message_id TEXT NOT NULL, seen_at INTEGER NOT NULL,
  PRIMARY KEY(account_id,message_id),
  FOREIGN KEY(account_id) REFERENCES email_accounts(id) ON DELETE CASCADE
);
