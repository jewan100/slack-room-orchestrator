PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE openclaw_event_outbox_new (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'ROOM_MODE_ON',
    'ROOM_MODE_OFF',
    'ROOM_QUESTION_TRIGGER'
  )),
  session_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'DISPATCHED')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  dispatched_at TEXT,
  last_error TEXT,
  FOREIGN KEY (session_id) REFERENCES room_sessions(id) ON DELETE CASCADE
);

INSERT INTO openclaw_event_outbox_new (
  id, event_id, event_type, session_id, channel_id, thread_ts,
  payload_json, status, retry_count, available_at, created_at, dispatched_at, last_error
)
SELECT
  id, event_id, event_type, session_id, channel_id, thread_ts,
  payload_json, status, retry_count, available_at, created_at, dispatched_at, last_error
FROM openclaw_event_outbox
WHERE event_type IN ('ROOM_MODE_ON', 'ROOM_MODE_OFF', 'ROOM_QUESTION_TRIGGER');

DROP TABLE openclaw_event_outbox;

ALTER TABLE openclaw_event_outbox_new RENAME TO openclaw_event_outbox;

CREATE INDEX IF NOT EXISTS idx_openclaw_event_outbox_status_available
  ON openclaw_event_outbox (status, available_at);

COMMIT;

PRAGMA foreign_keys = ON;
