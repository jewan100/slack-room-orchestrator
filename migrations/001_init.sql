CREATE TABLE IF NOT EXISTS room_sessions (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PREPARED', 'RUNNING', 'DECIDED')),
  requested_by_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  start_channel_id TEXT NOT NULL,
  start_thread_ts TEXT NOT NULL,
  launch_channel_id TEXT,
  launch_thread_ts TEXT,
  decided_option TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_sessions_active_per_channel
  ON room_sessions (start_channel_id)
  WHERE state IN ('PREPARED', 'RUNNING');

CREATE INDEX IF NOT EXISTS idx_room_sessions_state_channel
  ON room_sessions (state, start_channel_id);

CREATE TABLE IF NOT EXISTS room_briefings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  constraints TEXT NOT NULL,
  success_criteria TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES room_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_briefings_session_id
  ON room_briefings (session_id);

CREATE TABLE IF NOT EXISTS room_worker_rounds (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  candidates_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES room_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_worker_rounds_session_round
  ON room_worker_rounds (session_id, round_no);
