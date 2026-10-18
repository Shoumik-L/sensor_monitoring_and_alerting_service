// Sensor simulator / load generator.
//   node simulator.js --rate 10000 --seconds 1 --batch 100 --sensors 20 --anomaly 0.02
const BASE_URL = 'http://localhost:3000';

function getArgs() {
  const args = { rate: 1000, seconds: 5, batch: 100, sensors: 20, anomaly: 0.02, url: BASE_URL };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace('--', '');
    args[key] = key === 'url' ? argv[i + 1] : Number(argv[i + 1]);
  }
  return args;
}

const METRICS = {
  temperature: { normal: 22, spread: 3, spike: 15 },
  air_quality: { normal: 40, spread: 10, spike: 120 },
  occupancy: { normal: 30, spread: 10, spike: 150 },
};
const metricNames = Object.keys(METRICS);

const { rate, seconds, batch, sensors, anomaly, url } = getArgs();
const lastTimestamp = {}; // each sensor needs a different timestamp for every reading

function makeReading(i) {
  const sensorNumber = i % sensors;
  const type = metricNames[sensorNumber % metricNames.length];
  const m = METRICS[type];
  let value = m.normal + (Math.random() - 0.5) * 2 * m.spread;
  if (Math.random() < anomaly) value += m.spike; // occasional abnormal value -> triggers alerts
  const sensorId = `sim-${type}-${sensorNumber}`;
  const ts = Math.max(Date.now(), (lastTimestamp[sensorId] || 0) + 1);
  lastTimestamp[sensorId] = ts;
  return { sensorId, type, value: Math.round(value * 100) / 100, timestamp: new Date(ts).toISOString() };
}

async function post(path, body) {
  const start = performance.now();
  try {
    const res = await fetch(url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await res.text();
    return { status: res.status, ms: performance.now() - start };
  } catch {
    return { status: 0, ms: performance.now() - start };
  }
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] || 0;

async function main() {
  const before = await (await fetch(url + '/stats')).json();
  console.log(`Sending ${rate} readings/s for ${seconds}s (batches of ${batch}; 0 = one request per reading)`);

  const results = [];
  const pending = [];
  let index = 0;
  const startedAt = Date.now();

  for (let s = 0; s < seconds; s++) {
    const readings = Array.from({ length: rate }, () => makeReading(index++));
    if (batch > 0) {
      for (let i = 0; i < readings.length; i += batch) {
        pending.push(post('/readings/batch', readings.slice(i, i + batch)).then((r) => results.push({ ...r, n: batch })));
      }
    } else {
      for (const r of readings) pending.push(post('/readings', r).then((x) => results.push({ ...x, n: 1 })));
    }
    // wait until the next whole second so we offer exactly `rate` readings per second
    const wait = startedAt + (s + 1) * 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  await Promise.all(pending);
  const sendSeconds = (Date.now() - startedAt) / 1000;

  // wait until the server has written everything to the database
  const drainStart = Date.now();
  let after;
  do {
    await new Promise((r) => setTimeout(r, 100));
    after = await (await fetch(url + '/stats')).json();
  } while (after.buffered > 0 && Date.now() - drainStart < 60000);
  await new Promise((r) => setTimeout(r, 300)); // the last batch may still be inside the INSERT

  after = await (await fetch(url + '/stats')).json();
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const statusCounts = {};
  results.forEach((r) => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });

  console.log('\n--- Result ---');
  console.log('requests sent        :', results.length, JSON.stringify(statusCounts));
  console.log('time to send         :', sendSeconds.toFixed(2), 's');
  console.log('latency ms           : p50', percentile(latencies, 50).toFixed(1), '| p95', percentile(latencies, 95).toFixed(1), '| p99', percentile(latencies, 99).toFixed(1));
  console.log('saved in database    :', after.saved - before.saved);
  console.log('duplicates skipped   :', after.duplicates - before.duplicates);
  console.log('rejected (buffer full):', after.rejectedBecauseFull - before.rejectedBecauseFull);
  console.log('time to catch up     :', Date.now() - drainStart, 'ms after last request');
}

main().catch((e) => { console.error(e); process.exit(1); });
