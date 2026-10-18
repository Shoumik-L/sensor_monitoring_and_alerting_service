const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReading, validateRule } = require('../src/validate');

test('valid reading passes and timestamp is normalised', () => {
  const { reading, error } = validateReading({ sensorId: 's1', type: 'temperature', value: 34.5, timestamp: '2026-10-12T10:30:00Z' });
  assert.equal(error, undefined);
  assert.equal(reading.timestamp, '2026-10-12T10:30:00.000Z');
});

test('bad readings are rejected', () => {
  assert.ok(validateReading({ sensorId: '', type: 't', value: 1, timestamp: '2026-10-12T10:30:00Z' }).error);
  assert.ok(validateReading({ sensorId: 's', type: 't', value: '5', timestamp: '2026-10-12T10:30:00Z' }).error);
  assert.ok(validateReading({ sensorId: 's', type: 't', value: 5, timestamp: 'yesterday' }).error);
  assert.ok(validateReading(null).error);
});

test('window rule needs windowMinutes', () => {
  const base = { name: 'x', kind: 'window_avg', type: 'temperature', operator: '>', threshold: 25 };
  assert.ok(validateRule(base).error);
  assert.equal(validateRule({ ...base, windowMinutes: 10 }).error, undefined);
});

test('threshold rule ignores windowMinutes and rejects bad operator', () => {
  const base = { name: 'x', kind: 'threshold', type: 'temperature', operator: '>', threshold: 30, windowMinutes: 5 };
  assert.equal(validateRule(base).rule.windowMinutes, null);
  assert.ok(validateRule({ ...base, operator: '>=' }).error);
});
