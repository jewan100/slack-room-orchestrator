CREATE TABLE IF NOT EXISTS room_watch_targets (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ON', 'OFF')),
  mode TEXT NOT NULL CHECK (mode IN ('PLANNING')),
  ttl_expires_at TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_summary_triggered_count INTEGER NOT NULL DEFAULT 0,
  last_question_triggered_at TEXT,
  turned_on_at TEXT NOT NULL,
  turned_off_at TEXT,
  off_reason TEXT CHECK (off_reason IN ('LAUNCH', 'TTL')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES room_sessions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_watch_targets_channel_thread
  ON room_watch_targets (channel_id, thread_ts);

CREATE INDEX IF NOT EXISTS idx_room_watch_targets_status_ttl
  ON room_watch_targets (status, ttl_expires_at);

CREATE INDEX IF NOT EXISTS idx_room_watch_targets_status_question
  ON room_watch_targets (status, last_question_triggered_at);

CREATE INDEX IF NOT EXISTS idx_room_watch_targets_session_status
  ON room_watch_targets (session_id, status);

CREATE TABLE IF NOT EXISTS room_thread_messages (
  id TEXT PRIMARY KEY,
  watch_target_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  user_id TEXT,
  subtype TEXT,
  is_bot INTEGER NOT NULL CHECK (is_bot IN (0, 1)),
  event_ts TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (watch_target_id) REFERENCES room_watch_targets(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES room_sessions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_thread_messages_unique
  ON room_thread_messages (channel_id, thread_ts, message_ts);

CREATE INDEX IF NOT EXISTS idx_room_thread_messages_watch_target
  ON room_thread_messages (watch_target_id);

CREATE INDEX IF NOT EXISTS idx_room_thread_messages_session
  ON room_thread_messages (session_id);

CREATE TABLE IF NOT EXISTS openclaw_event_outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'ROOM_MODE_ON',
    'ROOM_MODE_OFF',
    'ROOM_SUMMARY_TRIGGER',
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

CREATE INDEX IF NOT EXISTS idx_openclaw_event_outbox_status_available
  ON openclaw_event_outbox (status, available_at);
