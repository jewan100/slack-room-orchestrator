WITH ranked_active_targets AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY channel_id
      ORDER BY created_at DESC, id DESC
    ) AS row_number
  FROM room_watch_targets
  WHERE status = 'ON'
)
UPDATE room_watch_targets
SET
  status = 'OFF',
  off_reason = COALESCE(off_reason, 'TTL'),
  turned_off_at = COALESCE(turned_off_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (
  SELECT id
  FROM ranked_active_targets
  WHERE row_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_watch_targets_active_per_channel
  ON room_watch_targets (channel_id)
  WHERE status = 'ON';
