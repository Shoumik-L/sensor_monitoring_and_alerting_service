// The background worker. This file is the heart of the project.
//
//   API  --push-->  buffer (a plain array)  --every 100 ms-->  one big INSERT  -->  check rules
//
// Why: answering an HTTP request must be fast. Saving to the database is slower, so the API
// only drops the readings into the buffer and replies immediately. The worker saves them in bulk.
const pool = require('./db');
const { findThresholdViolations } = require('./detect');
const { createAlertIfNew } = require('./alertService');

const MAX_BUFFER = Number(process.env.MAX_BUFFER) || 50000; // protect memory
const BATCH_SIZE = 2000;                                    // rows per INSERT
const FLUSH_EVERY_MS = 100;
const WINDOW_CHECK_EVERY_MS = Number(process.env.WINDOW_CHECK_MS) || 5000;

const buffer = [];
const stats = { saved: 0, duplicates: 0, rejectedBecauseFull: 0, errors: 0 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Called by the API. Returns false if the buffer is full (the API then answers 503).
function addReadings(readings) {
  if (buffer.length + readings.length > MAX_BUFFER) {
    stats.rejectedBecauseFull += readings.length;
    return false;
  }
  for (const r of readings) buffer.push(r);
  return true;
}

function getStats() {
  return { buffered: buffer.length, ...stats };
}

// One INSERT with many rows:  VALUES ($1,$2,$3,$4), ($5,$6,$7,$8), ...
// ON CONFLICT DO NOTHING = if the same reading already exists, skip it.
async function saveReadings(batch) {
  const values = [];
  const rows = batch.map((r, i) => {
    const o = i * 4;
    values.push(r.sensorId, r.type, r.value, r.timestamp);
    return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4})`;
  });
  const result = await pool.query(
    `INSERT INTO readings (sensor_id, type, value, ts) VALUES ${rows.join(', ')} ON CONFLICT DO NOTHING`,
    values
  );
  stats.saved += result.rowCount;
  stats.duplicates += batch.length - result.rowCount;
}

async function checkThresholdRules(batch) {
  const { rows: rules } = await pool.query(
    `SELECT * FROM alert_rules WHERE enabled = true AND kind = 'threshold'`
  );
  if (rules.length === 0) return;
  for (const v of findThresholdViolations(batch, rules)) {
    await createAlertIfNew(v.rule, v.sensorId, v.value, v.message);
  }
}

async function flushOnce() {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, BATCH_SIZE); // take up to 2000 readings out of the buffer
  try {
    await saveReadings(batch);
    await checkThresholdRules(batch);
  } catch (err) {
    // Database problem: put the readings back at the front and try again later. Nothing is lost.
    stats.errors++;
    console.error('flush failed, will retry:', err.message);
    buffer.unshift(...batch);
    await sleep(1000);
  }
}

async function flushLoop() {
  while (true) {
    await flushOnce();
    if (buffer.length < BATCH_SIZE) await sleep(FLUSH_EVERY_MS); // busy? go again immediately
  }
}

// Window rules ("average over 10 minutes") are checked by asking the database directly.
// One query per rule, every few seconds. The database stays the single source of truth,
// so nothing needs to be rebuilt after a restart.
async function checkWindowRules() {
  const { rows: rules } = await pool.query(
    `SELECT * FROM alert_rules WHERE enabled = true AND kind = 'window_avg'`
  );
  for (const rule of rules) {
    const op = rule.operator === '<' ? '<' : '>'; // only these two values ever reach the SQL text
    const { rows } = await pool.query(
      `SELECT sensor_id, AVG(value) AS avg_value
       FROM readings
       WHERE type = $1
         AND ($2::text IS NULL OR sensor_id = $2)
         AND ts > now() - make_interval(mins => $3)
       GROUP BY sensor_id
       HAVING AVG(value) ${op} $4`,
      [rule.type, rule.sensor_id, rule.window_minutes, rule.threshold]
    );
    for (const row of rows) {
      const avg = Number(row.avg_value);
      const message = `${rule.name}: average ${rule.type} over ${rule.window_minutes} min = ${avg.toFixed(2)} ${rule.operator} ${rule.threshold} on ${row.sensor_id}`;
      await createAlertIfNew(rule, row.sensor_id, avg, message);
    }
  }
}

async function windowLoop() {
  while (true) {
    try {
      await checkWindowRules();
    } catch (err) {
      console.error('window check failed:', err.message);
    }
    await sleep(WINDOW_CHECK_EVERY_MS);
  }
}

function startWorkers() {
  flushLoop();
  windowLoop();
}

module.exports = { addReadings, getStats, startWorkers, flushOnce };
