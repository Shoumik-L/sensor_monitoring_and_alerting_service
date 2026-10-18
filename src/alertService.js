const pool = require('./db');

// Creates an alert unless the same rule + sensor already has one that is still active.
// This stops a sensor that stays hot for an hour from creating thousands of alerts.
async function createAlertIfNew(rule, sensorId, value, message) {
  const existing = await pool.query(
    `SELECT 1 FROM alerts
     WHERE rule_id = $1 AND sensor_id = $2 AND status IN ('open', 'acknowledged')`,
    [rule.id, sensorId]
  );
  if (existing.rows.length > 0) return false;

  await pool.query(
    'INSERT INTO alerts (rule_id, sensor_id, message, value) VALUES ($1, $2, $3, $4)',
    [rule.id, sensorId, message, value]
  );
  return true;
}

module.exports = { createAlertIfNew };
