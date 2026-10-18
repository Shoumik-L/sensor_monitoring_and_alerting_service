// Checks incoming data by hand. Each function returns { error } or the cleaned object.

function validateReading(body) {
  if (!body || typeof body !== 'object') return { error: 'reading must be an object' };
  const { sensorId, type, value, timestamp } = body;
  if (typeof sensorId !== 'string' || sensorId.trim() === '') return { error: 'sensorId must be a non-empty string' };
  if (typeof type !== 'string' || type.trim() === '') return { error: 'type must be a non-empty string' };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { error: 'value must be a number' };
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    return { error: 'timestamp must be an ISO date string' };
  }
  return { reading: { sensorId, type, value, timestamp: new Date(timestamp).toISOString() } };
}

function validateRule(body) {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' };
  const { name, kind, type, sensorId = null, operator, threshold, windowMinutes = null, enabled = true } = body;
  if (typeof name !== 'string' || name.trim() === '') return { error: 'name is required' };
  if (!['threshold', 'window_avg'].includes(kind)) return { error: "kind must be 'threshold' or 'window_avg'" };
  if (typeof type !== 'string' || type.trim() === '') return { error: 'type is required (e.g. temperature)' };
  if (sensorId !== null && typeof sensorId !== 'string') return { error: 'sensorId must be a string or null' };
  if (!['>', '<'].includes(operator)) return { error: "operator must be '>' or '<'" };
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) return { error: 'threshold must be a number' };
  if (typeof enabled !== 'boolean') return { error: 'enabled must be true or false' };
  if (kind === 'window_avg') {
    if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440) {
      return { error: 'windowMinutes (1-1440) is required for window_avg rules' };
    }
  }
  return {
    rule: { name, kind, type, sensorId, operator, threshold, windowMinutes: kind === 'window_avg' ? windowMinutes : null, enabled },
  };
}

module.exports = { validateReading, validateRule };
