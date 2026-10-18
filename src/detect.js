// Pure rule logic (no database here, so it is easy to test).

function compare(value, operator, threshold) {
  return operator === '>' ? value > threshold : value < threshold;
}

// Looks at a batch of readings and returns the rule violations.
// We keep only ONE violation per (rule, sensor) per batch, so 500 hot readings
// in a row do not cause 500 database lookups.
function findThresholdViolations(readings, rules) {
  const found = new Map();
  for (const reading of readings) {
    for (const rule of rules) {
      if (rule.kind !== 'threshold') continue;
      if (rule.type !== reading.type) continue;
      if (rule.sensor_id && rule.sensor_id !== reading.sensorId) continue;
      if (!compare(reading.value, rule.operator, rule.threshold)) continue;

      const key = `${rule.id}|${reading.sensorId}`;
      if (!found.has(key)) {
        found.set(key, {
          rule,
          sensorId: reading.sensorId,
          value: reading.value,
          message: `${rule.name}: ${reading.type} ${reading.value} ${rule.operator} ${rule.threshold} on ${reading.sensorId}`,
        });
      }
    }
  }
  return [...found.values()];
}

module.exports = { compare, findThresholdViolations };
