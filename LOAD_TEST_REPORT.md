# Load Test Report: Burst of 10,000 Readings in One Second

## Environment

| Item | Value |
|---|---|
| CPU | 12 logical CPUs (`nproc`) |
| Memory | 7,566 MB total (`free -m`) |
| Node.js | v24.20.0 |
| Platform | WSL on a Windows laptop |
| Database | PostgreSQL, default settings, running on the same machine |
| Load generator | `simulator.js`, running on the same machine as the service and the database |
| Rules active | one threshold rule (`temperature > 30`) and one window rule (average temperature over 10 minutes `> 25`) |
| Simulation | 20 simulated sensors, 2% abnormal readings |

The service, the database, and the load generator all shared one machine, so each competed with the others for CPU.

## Commands

```bash
npm run simulate -- --rate 10000 --seconds 1  --batch 100      # A: burst, batches of 100
npm run simulate -- --rate 10000 --seconds 1  --batch 0        # B: burst, one request per reading
npm run simulate -- --rate 10000 --seconds 10 --batch 100      # C: sustained
```

## Results

| Scenario | Requests | Responses | Time to send | Latency p50 / p95 / p99 | Saved in database | Duplicates | Rejected (buffer full) |
|---|---|---|---|---|---|---|---|
| A: 10,000 readings in 1 s, 100 per request | 100 | 100 x `202` | 1.00 s | 134.9 / 137.6 / 147.0 ms | 10,000 | 0 | 0 |
| B: 10,000 readings, one per request | 10,000 | 10,000 x `202` | 5.35 s | 3,738 / 4,952 / 5,005 ms | 10,000 | 0 | 0 |
| C: 10,000 readings/s for 10 s, 100 per request | 1,000 | 1,000 x `202` | 10.00 s | 46.2 / 104.4 / 111.1 ms | 100,000 | 0 | 0 |

In all three runs the simulator reported the database as caught up about 410 to 415 ms after the last request. That figure includes a fixed 300 ms wait built into the simulator, so the actual catch-up time is shorter.

"Time to send" in scenarios A and C is the one-second (or ten-second) window the simulator paces itself to. In scenario B it is the time the simulator actually needed to get all 10,000 requests answered.

## Observations

* **Batched burst (A).** All 10,000 readings were accepted in one second, in 100 requests, each answered `202`. Every reading reached the database.
* **Single-reading requests (B).** All 10,000 separate requests were accepted and saved, but they took 5.35 seconds, an effective rate of about 1,870 requests per second. Because all 10,000 requests were started at once, the large latencies reflect requests waiting in line to be handled. The database was caught up immediately after the last request, so the limit was in handling the individual HTTP requests, not in writing to the database.
* **Sustained load (C).** 100,000 readings over 10 seconds were all accepted and saved, with p99 latency of 111.1 ms.
* **Nothing was lost or refused.** There were no failed requests, no duplicates, and no `503` responses in any scenario. The number of readings saved matched the number sent each time.
* **Alert de-duplication under load.** After the three runs (about 120,000 readings, 2% of them abnormal), seven threshold alerts were open, one for each of the seven simulated temperature sensors, rather than one per abnormal reading. The window rule had produced one alert for the sensor that had received manual test readings.

## Scope of this test

The test ran for at most 10 seconds at 10,000 readings per second. It did not cover long-running load, a database outage during ingestion, or window queries over millions of stored rows.
