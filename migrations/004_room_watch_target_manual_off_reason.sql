PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE room_watch_targets_new (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ON', 'OFF')),
  mode TEXT NOT NULL CHECK (mode IN ('PLANNING')),
  ttl_expires_at TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_question_triggered_at TEXT,
  turned_on_at TEXT NOT NULL,
  turned_off_at TEXT,
  off_reason TEXT CHECK (off_reason IN ('LAUNCH', 'TTL', 'MANUAL')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES room_sessions(id) ON DELETE CASCADE
);

INSERT INTO room_watch_targets_new (
  id, session_id, channel_id, thread_ts, status, mode, ttl_expires_at,
  message_count, last_question_triggered_at,
  turned_on_at, turned_off_at, off_reason, created_at, updated_at
)
SELECT
  id, session_id, channel_id, thread_ts, status, mode, ttl_expires_at,
  message_count, last_question_triggered_at,
  turned_on_at, turned_off_at, off_reason, created_at, updated_at
FROM room_watch_targets;

DROP TABLE room_watch_targets;

ALTER TABLE room_watch_targets_new RENAME TO room_watch_targets;

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_watch_targets_channel_thread
  ON room_watch_targets (channel_id, thread_ts);

CREATE INDEX IF NOT EXISTS idx_room_watch_targets_status_ttl
  ON room_watch_targets (status, ttl_expires_at);

CREATE INDEX IF NOT EXISTS idx_room_watch_targets_status_question
  ON room_watch_targets (status, last_question_triggered_at);

CREATE INDEX IF NOT EXISTS idx_room_watch_targets_session_status
  ON room_watch_targets (session_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_watch_targets_active_per_channel
  ON room_watch_targets (channel_id)
  WHERE status = 'ON';

COMMIT;

PRAGMA foreign_keys = ON;
