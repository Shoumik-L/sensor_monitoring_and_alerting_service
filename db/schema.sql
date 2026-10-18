-- 1) Every reading we receive. The primary key means the SAME reading sent twice is stored once.
CREATE TABLE IF NOT EXISTS readings (
  sensor_id TEXT NOT NULL,
  type      TEXT NOT NULL,
  value     DOUBLE PRECISION NOT NULL,
  ts        TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (sensor_id, type, ts)
);
CREATE INDEX IF NOT EXISTS readings_type_ts_idx ON readings (type, ts);

-- 2) Rules created by organizers.
--    kind = 'threshold'  -> checked on every reading        (e.g. temperature > 30)
--    kind = 'window_avg' -> average over last N minutes     (e.g. avg temperature over 10 min > 25)
CREATE TABLE IF NOT EXISTS alert_rules (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('threshold', 'window_avg')),
  type           TEXT NOT NULL,              -- which metric: temperature, air_quality, ...
  sensor_id      TEXT,                       -- NULL = every sensor of that type
  operator       TEXT NOT NULL CHECK (operator IN ('>', '<')),
  threshold      DOUBLE PRECISION NOT NULL,
  window_minutes INTEGER,                    -- only for window_avg
  enabled        BOOLEAN NOT NULL DEFAULT true
);

-- 3) Alerts created when a rule is broken.
CREATE TABLE IF NOT EXISTS alerts (
  id              SERIAL PRIMARY KEY,
  rule_id         INTEGER NOT NULL REFERENCES alert_rules(id),
  sensor_id       TEXT NOT NULL,
  message         TEXT NOT NULL,
  value           DOUBLE PRECISION NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ
);
