const express = require('express');
const { getStats } = require('./worker');

const app = express();
app.use(express.json({ limit: '5mb' })); // lets us read JSON bodies as req.body

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/stats', (req, res) => res.json(getStats()));

app.use('/readings', require('./routes/readings'));
app.use('/rules', require('./routes/rules'));
app.use('/alerts', require('./routes/alerts'));

app.use((req, res) => res.status(404).json({ error: 'not found' }));

// Error handler: any error thrown in a route ends up here (Express 5 catches async errors for us).
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

module.exports = app;
