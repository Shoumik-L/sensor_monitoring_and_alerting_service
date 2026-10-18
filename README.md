# Campus Sensor Monitoring and Alerts

A backend service that ingests campus sensor readings (temperature, air quality, occupancy, or any other metric), evaluates alert rules defined by organizers, and lets organizers manage rules and alerts. It accepts single readings and batches, and is built so that a burst of 10,000 readings in one second does not slow down the API. A sensor simulator is included for testing.

**Stack:** Node.js 18+, Express 5, PostgreSQL, the `pg` library. Plain JavaScript with no other dependencies.

## Overview

* **Ingestion:** `POST /readings` and `POST /readings/batch` validate the data, place it in an in-memory buffer, and reply `202 Accepted` immediately.
* **Storage:** a background worker writes the buffered readings to PostgreSQL in bulk.
* **Rules:** organizers create, edit, enable and disable rules. Two kinds exist: a threshold rule checked against single readings (for example temperature above 30) and a time-window rule checked against an average over the last N minutes (for example average temperature over 10 minutes above 25).
* **Alerts:** a broken rule creates an alert. Organizers list alerts, acknowledge them, and resolve them.

## How it works

The API never writes a reading to the database itself. Saving 10,000 readings with 10,000 separate queries would overload the database and slow every request, so ingestion and storage are separated:

```
sensors --> Express API --> validate --> buffer (array in memory) --> reply 202 immediately
                                              |
              worker loop, every 100 ms       |  takes up to 2,000 readings
                                              v
                    one multi-row INSERT into PostgreSQL --> check threshold rules --> alerts table

time-window rules:  every 5 seconds, one SQL query per rule:
                    AVG(value) over the last N minutes, grouped by sensor --> alerts table
```

### The life of one reading

1. `POST /readings` arrives (`src/routes/readings.js`).
2. `src/validate.js` checks it: `sensorId` and `type` must be non-empty strings, `value` a finite number, `timestamp` a valid ISO date. Invalid data is answered with `400`.
3. `addReadings()` in `src/worker.js` pushes it into the buffer and the API replies `202`. If the buffer already holds 50,000 readings, the API replies `503` with `Retry-After: 1` instead (backpressure), so memory use stays bounded.
4. The worker loop takes up to 2,000 readings out of the buffer every 100 ms.
5. `saveReadings()` writes them with a single `INSERT ... VALUES (...), (...), ... ON CONFLICT DO NOTHING`.
6. `checkThresholdRules()` loads the enabled threshold rules and compares the saved readings against them.
7. `createAlertIfNew()` creates an alert unless the same rule and sensor already has an active one.

## Project structure

```
db/schema.sql                 the three tables
src/server.js                 creates the tables, starts the worker loops, starts the web server
src/app.js                    Express setup, /health, /stats, error handler
src/db.js                     database connection pool
src/setup.js                  applies db/schema.sql at startup
src/validate.js               hand-written validation for readings and rules
src/worker.js                 buffer, bulk insert, threshold check, window check loops
src/detect.js                 pure threshold-rule logic (no database)
src/alertService.js           creates an alert unless one is already active
src/routes/readings.js        POST /readings, POST /readings/batch
src/routes/rules.js           create, list, get, edit, enable, disable rules
src/routes/alerts.js          list, get, acknowledge, resolve alerts
simulator.js                  sensor simulator and load generator
test/                         unit tests for validation and rule detection
```

## Database

| Table | Purpose | Key rule |
|---|---|---|
| `readings` | every stored reading: `sensor_id`, `type`, `value`, `ts` | `PRIMARY KEY (sensor_id, type, ts)`: the same reading sent twice is stored once. An index on `(type, ts)` supports the window queries |
| `alert_rules` | rules created by organizers | `kind` is `threshold` or `window_avg`; `operator` is `>` or `<`; `sensor_id` is optional (empty means every sensor of that type); `window_minutes` is required for window rules |
| `alerts` | alerts raised by rules | `status` is `open`, `acknowledged` or `resolved`, with timestamps for each change |

## Rules

**Threshold rule.** Compares each reading with a threshold, for example `temperature > 30`. After each batch is saved, the readings are compared with every enabled threshold rule in memory (`src/detect.js`). If many readings from one sensor break the same rule within one batch, they collapse into a single violation, so 500 hot readings cause one database lookup instead of 500.

**Time-window rule.** Compares an average over the last N minutes with a threshold, for example the 10-minute average temperature above 25. A second loop runs every 5 seconds (configurable) and executes one query per enabled window rule:

```sql
SELECT sensor_id, AVG(value) FROM readings
WHERE type = ... AND ts > now() - (N minutes)
GROUP BY sensor_id HAVING AVG(value) > threshold
```

The database holds the history, so nothing has to be rebuilt after a restart. Window rules use the server clock, so only readings whose timestamps fall within the last N minutes count. A reading with an old timestamp is stored, and threshold rules still apply to it, but it is outside every current window.

Rules are read from the database on every check, so creating, editing, enabling, or disabling a rule takes effect immediately without a restart.

## Alerts

* **One active alert per rule and sensor.** Before creating an alert, the service checks for an existing `open` or `acknowledged` alert for the same rule and sensor. A sensor that stays above its threshold for an hour produces one alert. After an organizer resolves it, the next violation creates a new alert.
* **Status flow:** `open` to `acknowledged` to `resolved`, or `open` directly to `resolved`. Each change is a single `UPDATE ... WHERE status = ...`, so if two organizers act at the same moment, one succeeds and the other receives `409`.

## Reliability and throughput

**Bursts.** The API only validates and appends to an array, and the worker writes up to 2,000 readings per statement, so 10,000 readings per second become a handful of SQL statements per second. A load test is described in `LOAD_TEST_REPORT.md`.

**Backpressure.** The buffer holds at most 50,000 readings (`MAX_BUFFER`). When it is full the API answers `503` with `Retry-After: 1`.

**Safe retries.** The primary key `(sensor_id, type, ts)` together with `ON CONFLICT DO NOTHING` means a sender that retries after a `503` cannot create duplicate readings.

**Database failures.** If a batch cannot be saved, the readings are put back at the front of the buffer, the worker waits one second, and tries again. Nothing is dropped while the process is running.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/readings` | One reading. Replies `202 {"accepted": 1}` |
| POST | `/readings/batch` | A JSON array of readings (up to 20,000). Replies `202` with `accepted`, `rejected` and the first invalid items in `errors` |
| POST | `/rules` | Create a rule |
| GET | `/rules`, `/rules/:id` | List / get |
| PUT | `/rules/:id` | Edit a rule; send only the fields to change |
| POST | `/rules/:id/enable`, `/rules/:id/disable` | Turn a rule on or off |
| GET | `/alerts` | List alerts, optional filters `?status=open&sensorId=...`, newest first, up to 200 |
| GET | `/alerts/:id` | Get one alert |
| POST | `/alerts/:id/acknowledge` | `open` to `acknowledged`; `409` otherwise |
| POST | `/alerts/:id/resolve` | `open` or `acknowledged` to `resolved`; `409` otherwise |
| GET | `/stats` | `buffered`, `saved`, `duplicates`, `rejectedBecauseFull`, `errors` |
| GET | `/health` | Liveness check |

Example reading:

```json
{
  "sensorId": "library-floor-2",
  "type": "temperature",
  "value": 34.5,
  "timestamp": "2026-10-12T10:30:00Z"
}
```

Rule fields: `name`, `kind` (`threshold` or `window_avg`), `type` (the metric), `sensorId` (optional), `operator` (`>` or `<`), `threshold`, `windowMinutes` (1 to 1440, window rules only), `enabled`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/sensors` | Database connection |
| `PORT` | 3000 | API port |
| `MAX_BUFFER` | 50000 | Maximum readings held in memory before the API answers `503` |
| `WINDOW_CHECK_MS` | 5000 | How often window rules are evaluated |

## Running locally

### Requirements

* Node.js 18 or newer (`node -v`)
* PostgreSQL (`psql --version`)

On Windows with WSL, run PostgreSQL, the service, and the simulator all inside WSL.

### Setup

Start PostgreSQL (on WSL this is needed each time WSL is restarted):

```bash
sudo service postgresql start
```

Create the database, using your own password:

```bash
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'YOURPASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE sensors;"
```

Install dependencies:

```bash
npm install
```

The tables are created automatically when the service starts.

### Start the service

```bash
DATABASE_URL=postgres://postgres:YOURPASSWORD@localhost:5432/sensors npm start
```

The service prints `listening on http://localhost:3000`.

### Example session

Create a threshold rule and a time-window rule:

```bash
curl -X POST localhost:3000/rules -H 'Content-Type: application/json' \
  -d '{"name":"Too hot","kind":"threshold","type":"temperature","operator":">","threshold":30}'

curl -X POST localhost:3000/rules -H 'Content-Type: application/json' \
  -d '{"name":"Sustained heat","kind":"window_avg","type":"temperature","operator":">","threshold":25,"windowMinutes":10}'
```

Send a reading that breaks the threshold rule, then list the alerts:

```bash
curl -X POST localhost:3000/readings -H 'Content-Type: application/json' \
  -d "{\"sensorId\":\"library-floor-2\",\"type\":\"temperature\",\"value\":34.5,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"

curl localhost:3000/alerts
```

Acknowledge and resolve the alert:

```bash
curl -X POST localhost:3000/alerts/1/acknowledge
curl -X POST localhost:3000/alerts/1/resolve
```

### Sensor simulator

`simulator.js` generates readings for simulated temperature, air quality and occupancy sensors, with a configurable share of abnormal values so that rules fire. It prints the number of requests and their status codes, latency percentiles, how many readings were saved, and how long the database took to catch up.

```bash
npm run simulate -- --rate 10000 --seconds 1 --batch 100
```

| Option | Default | Meaning |
|---|---|---|
| `--rate` | 1000 | Readings per second |
| `--seconds` | 5 | Duration |
| `--batch` | 100 | Readings per request; `0` sends one request per reading |
| `--sensors` | 20 | Number of simulated sensors (sensor `n` has the metric at position `n % 3` in temperature, air_quality, occupancy) |
| `--anomaly` | 0.02 | Share of abnormal readings |
| `--url` | `http://localhost:3000` | Target service |

### Tests

```bash
npm test
```

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL is not running. Run `sudo service postgresql start`. |
| `password authentication failed` | The password in `DATABASE_URL` differs from the one set for the `postgres` user. |
| `database "sensors" does not exist` | Create it with `CREATE DATABASE sensors;`. |
| `EADDRINUSE` on port 3000 | Another process uses the port. Stop it, or set `PORT`. |
| A window rule never fires | Window rules only count readings from the last N minutes. Send readings with current timestamps and wait for the next check (up to `WINDOW_CHECK_MS`). |
| `fetch is not defined` | Node is older than 18. |

## Design decisions and limitations

* The API replies `202` before readings reach the database. If the process is killed abruptly, readings still in the buffer (up to about 100 ms worth) are lost. A normal shutdown does not flush the buffer.
* Window rules are evaluated every 5 seconds against the server clock, so a window alert can appear up to 5 seconds after the condition becomes true.
* A window query scans the readings of the last N minutes. At very high sustained rates and long windows this grows with the amount of stored data.
* Two different readings from the same sensor and type with the same millisecond timestamp are treated as one.
* Alert creation is a check followed by an insert, which is safe with a single service instance.
* There is no authentication.
