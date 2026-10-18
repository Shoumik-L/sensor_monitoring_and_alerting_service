const express = require('express');
const { validateReading } = require('../validate');
const { addReadings } = require('../worker');

const router = express.Router();
const MAX_BATCH = 20000;

// One reading
router.post('/', (req, res) => {
  const { error, reading } = validateReading(req.body);
  if (error) return res.status(400).json({ error });
  if (!addReadings([reading])) return res.status(503).set('Retry-After', '1').json({ error: 'server busy, retry' });
  res.status(202).json({ accepted: 1 }); // 202 = received, will be processed in the background
});

// Many readings: body is a JSON array
router.post('/batch', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'body must be an array of readings' });
  if (req.body.length === 0) return res.status(400).json({ error: 'batch is empty' });
  if (req.body.length > MAX_BATCH) return res.status(413).json({ error: `max ${MAX_BATCH} readings per batch` });

  const valid = [];
  const errors = [];
  req.body.forEach((item, index) => {
    const result = validateReading(item);
    if (result.error) {
      if (errors.length < 10) errors.push({ index, error: result.error });
    } else {
      valid.push(result.reading);
    }
  });

  if (valid.length === 0) return res.status(400).json({ error: 'no valid readings', errors });
  if (!addReadings(valid)) return res.status(503).set('Retry-After', '1').json({ error: 'server busy, retry' });
  res.status(202).json({ accepted: valid.length, rejected: req.body.length - valid.length, errors });
});

module.exports = router;
