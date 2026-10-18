const app = require('./app');
const { setupDatabase } = require('./setup');
const { startWorkers } = require('./worker');

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  await setupDatabase();   // 1. make sure tables exist
  startWorkers();          // 2. start the background loops
  const server = app.listen(PORT, () => console.log(`listening on http://localhost:${PORT}`)); // 3. accept requests
  server.keepAliveTimeout = 65000;
}

main().catch((err) => {
  console.error('failed to start:', err);
  process.exit(1);
});
