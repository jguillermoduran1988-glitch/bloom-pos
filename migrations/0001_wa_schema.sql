-- WhatsApp CRM schema para Cloudflare D1

CREATE TABLE IF NOT EXISTS wa_contacts (
  phone       TEXT PRIMARY KEY,
  name        TEXT,
  email       TEXT,
  avatar      TEXT,
  store       TEXT DEFAULT 'bloom',
  tags        TEXT DEFAULT '[]',
  ref_source  TEXT,
  ref_headline TEXT,
  ref_ctwa_clid TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wa_conversations (
  id              TEXT PRIMARY KEY,
  phone           TEXT NOT NULL,
  store           TEXT DEFAULT 'bloom',
  status          TEXT DEFAULT 'open',
  assigned_to     TEXT,
  last_message    TEXT,
  last_message_at TEXT,
  unread_count    INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wa_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  wa_message_id   TEXT,
  direction       TEXT NOT NULL,
  type            TEXT DEFAULT 'text',
  body            TEXT,
  media_url       TEXT,
  status          TEXT DEFAULT 'sent',
  ts              TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_conv   ON wa_messages(conversation_id, ts);
CREATE INDEX IF NOT EXISTS idx_wa_conv_phone      ON wa_conversations(phone);
CREATE INDEX IF NOT EXISTS idx_wa_conv_updated    ON wa_conversations(store, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_conv_status     ON wa_conversations(store, status);
