const express = require('express');
const pool = require('../db');

const router = express.Router();

const toAlert = (a) => ({
  id: a.id, ruleId: a.rule_id, sensorId: a.sensor_id, message: a.message, value: a.value,
  status: a.status, createdAt: a.created_at, acknowledgedAt: a.acknowledged_at, resolvedAt: a.resolved_at,
});

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// List alerts. Optional filters: ?status=open&sensorId=abc
router.get('/', async (req, res) => {
  const { status, sensorId } = req.query;
  if (status && !['open', 'acknowledged', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'status must be open, acknowledged or resolved' });
  }
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
  if (sensorId) { params.push(sensorId); conditions.push(`sensor_id = $${params.length}`); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const { rows } = await pool.query(`SELECT * FROM alerts ${where} ORDER BY id DESC LIMIT 200`, params);
  res.json(rows.map(toAlert));
});

router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { rows } = await pool.query('SELECT * FROM alerts WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'alert not found' });
  res.json(toAlert(rows[0]));
});

// Move an alert to a new status, but only if it is currently in an allowed status.
// Doing this inside one UPDATE ... WHERE status = ... means two people clicking at once is safe.
async function changeStatus(req, res, newStatus, allowedFrom, timeColumn) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { rows } = await pool.query(
    `UPDATE alerts SET status = $1, ${timeColumn} = now() WHERE id = $2 AND status = ANY($3) RETURNING *`,
    [newStatus, id, allowedFrom]
  );
  if (rows[0]) return res.json(toAlert(rows[0]));

  const existing = await pool.query('SELECT status FROM alerts WHERE id = $1', [id]);
  if (!existing.rows[0]) return res.status(404).json({ error: 'alert not found' });
  res.status(409).json({ error: `alert is already ${existing.rows[0].status}` });
}

router.post('/:id/acknowledge', (req, res) => changeStatus(req, res, 'acknowledged', ['open'], 'acknowledged_at'));
router.post('/:id/resolve', (req, res) => changeStatus(req, res, 'resolved', ['open', 'acknowledged'], 'resolved_at'));

module.exports = router;
