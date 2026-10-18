const express = require('express');
const pool = require('../db');
const { validateRule } = require('../validate');

const router = express.Router();

const toRule = (r) => ({
  id: r.id, name: r.name, kind: r.kind, type: r.type, sensorId: r.sensor_id,
  operator: r.operator, threshold: r.threshold, windowMinutes: r.window_minutes, enabled: r.enabled,
});

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Create
router.post('/', async (req, res) => {
  const { error, rule } = validateRule(req.body);
  if (error) return res.status(400).json({ error });
  const { rows } = await pool.query(
    `INSERT INTO alert_rules (name, kind, type, sensor_id, operator, threshold, window_minutes, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [rule.name, rule.kind, rule.type, rule.sensorId, rule.operator, rule.threshold, rule.windowMinutes, rule.enabled]
  );
  res.status(201).json(toRule(rows[0]));
});

// List
router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM alert_rules ORDER BY id');
  res.json(rows.map(toRule));
});

// Get one
router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { rows } = await pool.query('SELECT * FROM alert_rules WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'rule not found' });
  res.json(toRule(rows[0]));
});

// Edit: send only the fields you want to change
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const existing = await pool.query('SELECT * FROM alert_rules WHERE id = $1', [id]);
  if (!existing.rows[0]) return res.status(404).json({ error: 'rule not found' });

  const merged = { ...toRule(existing.rows[0]), ...(req.body || {}) }; // old values + changes
  const { error, rule } = validateRule(merged);
  if (error) return res.status(400).json({ error });

  const { rows } = await pool.query(
    `UPDATE alert_rules SET name=$1, kind=$2, type=$3, sensor_id=$4, operator=$5,
       threshold=$6, window_minutes=$7, enabled=$8 WHERE id=$9 RETURNING *`,
    [rule.name, rule.kind, rule.type, rule.sensorId, rule.operator, rule.threshold, rule.windowMinutes, rule.enabled, id]
  );
  res.json(toRule(rows[0]));
});

// Enable / disable. The worker reads rules from the database every time, so this works instantly.
async function setEnabled(req, res, enabled) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { rows } = await pool.query('UPDATE alert_rules SET enabled = $1 WHERE id = $2 RETURNING *', [enabled, id]);
  if (!rows[0]) return res.status(404).json({ error: 'rule not found' });
  res.json(toRule(rows[0]));
}
router.post('/:id/enable', (req, res) => setEnabled(req, res, true));
router.post('/:id/disable', (req, res) => setEnabled(req, res, false));

module.exports = router;
