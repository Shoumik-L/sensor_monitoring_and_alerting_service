// One shared connection pool for the whole app.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/sensors',
});

module.exports = pool;
