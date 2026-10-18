const test = require('node:test');
const assert = require('node:assert/strict');
const { compare, findThresholdViolations } = require('../src/detect');

const rule = (over = {}) => ({ id: 1, name: 'Hot', kind: 'threshold', type: 'temperature', sensor_id: null, operator: '>', threshold: 30, ...over });
const reading = (value, sensorId = 's1', type = 'temperature') => ({ sensorId, type, value });

test('compare', () => {
  assert.equal(compare(31, '>', 30), true);
  assert.equal(compare(30, '>', 30), false);
  assert.equal(compare(5, '<', 10), true);
});

test('only readings that break the rule produce a violation', () => {
  assert.equal(findThresholdViolations([reading(29), reading(30)], [rule()]).length, 0);
  const v = findThresholdViolations([reading(34.5)], [rule()]);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /34.5/);
});

test('many hot readings from one sensor give ONE violation', () => {
  const v = findThresholdViolations([reading(31), reading(32), reading(33), reading(50, 's2')], [rule()]);
  assert.equal(v.length, 2);
});

test('rule can be limited to one sensor and must match the type', () => {
  assert.equal(findThresholdViolations([reading(50, 'gym')], [rule({ sensor_id: 'library' })]).length, 0);
  assert.equal(findThresholdViolations([reading(50, 'library', 'humidity')], [rule()]).length, 0);
  assert.equal(findThresholdViolations([reading(50, 'library')], [rule({ sensor_id: 'library' })]).length, 1);
});

test('window rules are ignored here (they run in SQL)', () => {
  assert.equal(findThresholdViolations([reading(99)], [rule({ kind: 'window_avg' })]).length, 0);
});
