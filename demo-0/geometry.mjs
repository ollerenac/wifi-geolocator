// Pure geometry: the estimator never receives the known AP coordinate.
const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;
export const BSSID_PATTERN = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export function toLocal(latitude, longitude, origin) {
  if (![latitude, longitude, origin.latitude, origin.longitude].every(Number.isFinite)
      || Math.abs(latitude) > 85 || Math.abs(origin.latitude) > 85
      || Math.abs(longitude) > 180 || Math.abs(origin.longitude) > 180) {
    throw new Error('Use valid coordinates between 85° south and 85° north.');
  }
  let deltaLongitude = longitude - origin.longitude;
  deltaLongitude = ((deltaLongitude + 540) % 360) - 180;
  const point = {
    x: EARTH_RADIUS_M * deltaLongitude * RAD * Math.cos(origin.latitude * RAD),
    y: EARTH_RADIUS_M * (latitude - origin.latitude) * RAD,
  };
  if (Math.hypot(point.x, point.y) > 5000) {
    throw new Error('This local-plane demo supports points within 5 km of the origin.');
  }
  return point;
}

export function toGPS(x, y, origin) {
  const longitude = origin.longitude + x / (EARTH_RADIUS_M * RAD * Math.cos(origin.latitude * RAD));
  return {
    latitude: origin.latitude + y / (EARTH_RADIUS_M * RAD),
    longitude: ((longitude + 540) % 360) - 180,
  };
}

export function bearingTo(from, to) {
  return (Math.atan2(to.x - from.x, to.y - from.y) / RAD + 360) % 360;
}

export function angleDifference(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function predictRSSI(distanceM, model) {
  return model.referenceDbm - 10 * model.exponent * Math.log10(Math.max(1, distanceM));
}

export function distanceInterval(observation, model) {
  const highDbm = observation.rssiDbm + model.toleranceDb;
  const lowDbm = observation.rssiDbm - model.toleranceDb;
  if (lowDbm > model.referenceDbm) return null;
  const minimum = highDbm >= model.referenceDbm
    ? 0 : 10 ** ((model.referenceDbm - highDbm) / (10 * model.exponent));
  const maximum = 10 ** ((model.referenceDbm - lowDbm) / (10 * model.exponent));
  return {
    min: Math.max(0, minimum - observation.gpsAccuracyM),
    max: maximum + observation.gpsAccuracyM,
    nominal: 10 ** ((model.referenceDbm - observation.rssiDbm) / (10 * model.exponent)),
  };
}

export function bearingCompatible(point, observation) {
  const distance = Math.hypot(point.x - observation.x, point.y - observation.y);
  if (distance <= observation.gpsAccuracyM) return true;
  const positionAngle = Math.asin(Math.min(1, observation.gpsAccuracyM / distance)) / RAD;
  return angleDifference(bearingTo(observation, point), observation.bearingDeg)
    <= observation.bearingUncertaintyDeg + positionAngle;
}

export function constraintsFor(observations, model, mode) {
  return observations.filter(o => o.enabled).map(o => {
    if ((mode === 'bearing' || mode === 'combined')
        && (!Number.isFinite(o.bearingDeg) || !Number.isFinite(o.bearingUncertaintyDeg))) {
      throw new Error(`${o.id}: enter a bearing and its angular tolerance, or deselect this station.`);
    }
    return { observation: o, interval: mode === 'bearing' ? null : distanceInterval(o, model) };
  });
}

export function compatible(point, constraints, mode) {
  return constraints.every(({ observation: o, interval }) => {
    const distance = Math.hypot(point.x - o.x, point.y - o.y);
    if (mode !== 'bearing' && (!interval || distance < interval.min || distance > interval.max)) return false;
    return mode === 'rssi' || bearingCompatible(point, o);
  });
}

function residualScore(point, constraints, model, mode) {
  return constraints.reduce((score, { observation: o }) => {
    if (mode !== 'bearing') {
      const distance = Math.hypot(point.x - o.x, point.y - o.y);
      score += ((predictRSSI(distance, model) - o.rssiDbm) / model.toleranceDb) ** 2;
    }
    if (mode !== 'rssi') {
      score += (angleDifference(bearingTo(o, point), o.bearingDeg) / Math.max(0.1, o.bearingUncertaintyDeg)) ** 2;
    }
    return score;
  }, 0);
}

export function solveRegion(observations, model, bounds, mode = 'rssi', columns = 240) {
  const constraints = constraintsFor(observations, model, mode);
  const step = Math.max(bounds.width, bounds.height) / columns;
  const nx = Math.ceil(bounds.width / step);
  const ny = Math.ceil(bounds.height / step);
  let count = 0, area = 0, best = null, bestScore = Infinity, touchesBoundary = false;
  const runs = [];
  if (!constraints.length) return { runs, area, count, best, touchesBoundary, step, constraints };
  // Sample cell centres; retain horizontal runs for a compact SVG region.
  for (let iy = 0; iy < ny; iy++) {
    const y0 = iy * step;
    const cellHeight = Math.min(step, bounds.height - y0);
    let start = null;
    for (let ix = 0; ix <= nx; ix++) {
      const x0 = ix * step;
      const cellWidth = Math.min(step, bounds.width - x0);
      const point = { x: x0 + cellWidth / 2, y: y0 + cellHeight / 2 };
      const accepted = ix < nx && compatible(point, constraints, mode);
      if (accepted) {
        count++;
        area += cellWidth * cellHeight;
        if (start === null) start = x0;
        touchesBoundary ||= ix === 0 || iy === 0 || ix === nx - 1 || iy === ny - 1;
        const score = residualScore(point, constraints, model, mode);
        if (score < bestScore) { bestScore = score; best = point; }
      } else if (start !== null) {
        runs.push({ x: start, y: y0, width: Math.min(x0, bounds.width) - start, height: cellHeight });
        start = null;
      }
    }
  }
  return { runs, area, count, best, touchesBoundary, step, constraints };
}

export function validateSession(session) {
  const fail = message => { throw new Error(message); };
  const numeric = (value, min, max, name) => {
    if (!Number.isFinite(value) || value < min || value > max) fail(`${name} must be between ${min} and ${max}.`);
  };
  if (session.version !== 1) fail('Unsupported session version.');
  if (!['synthetic', 'field'].includes(session.source)) fail('Choose synthetic or field data.');
  if (!BSSID_PATTERN.test(session.target?.bssid)) fail('Enter a BSSID such as 02:00:00:00:00:01.');
  if (typeof session.target.ssid !== 'string') fail('SSID must be text.');
  numeric(session.target.channel, 1, 233, 'Channel');
  if (!Number.isInteger(session.target.channel)) fail('Channel must be an integer.');
  numeric(session.origin?.latitude, -85, 85, 'Origin latitude');
  numeric(session.origin?.longitude, -180, 180, 'Origin longitude');
  numeric(session.bounds?.width, 10, 3000, 'Plot width');
  numeric(session.bounds?.height, 10, 3000, 'Plot height');
  numeric(session.model?.referenceDbm, -120, 0, 'Reference RSSI');
  numeric(session.model?.exponent, 0.5, 6, 'Path-loss exponent');
  numeric(session.model?.toleranceDb, 0.1, 30, 'RSSI tolerance');
  if (typeof session.model.calibrated !== 'boolean') fail('Calibration flag must be true or false.');
  if (!Array.isArray(session.observations) || session.observations.length > 30) fail('Use at most 30 stations.');
  const ids = new Set();
  for (const o of session.observations) {
    if (typeof o.id !== 'string' || !o.id.trim() || o.id.length > 40 || ids.has(o.id)) fail('Station IDs must be unique, nonempty text (up to 40 characters).');
    ids.add(o.id);
    numeric(o.x, 0, session.bounds.width, `${o.id} east coordinate`);
    numeric(o.y, 0, session.bounds.height, `${o.id} north coordinate`);
    numeric(o.gpsAccuracyM, 0, 500, `${o.id} GPS accuracy`);
    numeric(o.rssiDbm, -127, 0, `${o.id} RSSI`);
    if (o.bearingDeg !== null) numeric(o.bearingDeg, 0, 359.999999, `${o.id} bearing`);
    if (o.bearingUncertaintyDeg !== null) numeric(o.bearingUncertaintyDeg, 0.1, 90, `${o.id} angular tolerance`);
    if ((o.bearingDeg === null) !== (o.bearingUncertaintyDeg === null)) fail(`${o.id}: provide both bearing fields or leave both empty.`);
    if (typeof o.enabled !== 'boolean') fail(`${o.id}: enabled must be true or false.`);
    if (!Number.isInteger(o.sampleCount) || o.sampleCount < 1 || o.sampleCount > 1000000) fail(`${o.id}: sample count must be a positive integer.`);
    numeric(o.spreadDb, 0, 60, `${o.id} RSSI spread`);
    if (typeof o.notes !== 'string' || o.notes.length > 2000) fail(`${o.id}: notes must be text up to 2000 characters.`);
    if (typeof o.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(o.timestamp) || !Number.isFinite(Date.parse(o.timestamp))) fail(`${o.id}: use an ISO timestamp with a timezone.`);
  }
  if (session.truth !== null) {
    numeric(session.truth?.x, 0, session.bounds.width, 'Known AP east coordinate');
    numeric(session.truth?.y, 0, session.bounds.height, 'Known AP north coordinate');
    numeric(session.truth?.accuracyM, 0, 500, 'Known AP GPS accuracy');
  }
  return session;
}

export function distinctStationCount(observations) {
  return new Set(observations.filter(o => o.enabled).map(o => `${o.x.toFixed(2)},${o.y.toFixed(2)}`)).size;
}

export function fitCalibration(rows) {
  if (rows.length < 3 || rows.some(r => !Number.isFinite(r.distanceM) || r.distanceM < 1 || !Number.isFinite(r.rssiDbm) || r.rssiDbm > 0 || r.rssiDbm < -127)) {
    throw new Error('Enter at least three distance/RSSI pairs, using distances ≥ 1 m and RSSI in dBm.');
  }
  const xs = rows.map(r => Math.log10(r.distanceM));
  const ys = rows.map(r => r.rssiDbm);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const variance = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (variance < 0.001) throw new Error('Calibration needs meaningfully different known distances.');
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / variance;
  const exponent = -slope / 10;
  const referenceDbm = my - slope * mx;
  if (exponent < 0.5 || exponent > 6 || referenceDbm < -120 || referenceDbm > 0) throw new Error('Calibration produced implausible parameters. Check units, distances, and receiver settings.');
  const rmsDb = Math.sqrt(xs.reduce((s, x, i) => s + (ys[i] - (referenceDbm + slope * x)) ** 2, 0) / xs.length);
  return { referenceDbm, exponent, rmsDb };
}

export function summarizeSamples(samples) {
  if (!samples.length || samples.some(s => !Number.isFinite(s) || s < -127 || s > 0)) throw new Error('Enter RSSI samples between −127 and 0 dBm.');
  const sorted = [...samples].sort((a, b) => a - b);
  const medianOf = list => list.length % 2 ? list[(list.length - 1) / 2] : (list[list.length / 2 - 1] + list[list.length / 2]) / 2;
  const median = medianOf(sorted);
  const deviations = sorted.map(s => Math.abs(s - median)).sort((a, b) => a - b);
  return { median, spreadDb: medianOf(deviations), sampleCount: samples.length };
}

export function makeDemoSession() {
  const model = { referenceDbm: -38, exponent: 2.2, toleranceDb: 3, calibrated: false };
  const truth = { x: 64, y: 46, accuracyM: 2 };
  const stations = [{ x: 14, y: 12 }, { x: 15, y: 76 }, { x: 105, y: 75 }, { x: 106, y: 13 }];
  const errors = [0.6, -1.1, 0.8, -0.4];
  return {
    version: 1, source: 'synthetic', target: { ssid: 'Field test AP', bssid: '02:00:00:00:00:01', channel: 6 },
    origin: { latitude: -12.0464, longitude: -77.0428 }, bounds: { width: 120, height: 90 }, model, truth,
    observations: stations.map((p, i) => ({
      id: `M${i + 1}`, ...p, gpsAccuracyM: 2,
      rssiDbm: Math.round((predictRSSI(Math.hypot(p.x - truth.x, p.y - truth.y), model) + errors[i]) * 10) / 10,
      bearingDeg: Math.round((bearingTo(p, truth) + errors[i] * 2 + 360) % 360 * 10) / 10,
      bearingUncertaintyDeg: 8, enabled: true, timestamp: '2026-09-28T12:00:00Z',
      sampleCount: 30, spreadDb: 1.2, notes: 'Simulated observation; not a hardware measurement.',
    })),
  };
}

export function parseCSV(text) {
  if (text.length > 1000000) throw new Error('CSV is too large. Use a summarized observation file under 1 MB.');
  const rows = []; let row = [], value = '', quoted = false;
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else if (quoted) quoted = false;
      else if (!value) quoted = true;
      else throw new Error('Malformed CSV quoting.');
    } else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if (char === '\n' && !quoted) { row.push(value); if (row.some(v => v.trim())) rows.push(row); row = []; value = ''; }
    else value += char;
  }
  if (quoted) throw new Error('CSV has an unclosed quotation mark.');
  row.push(value); if (row.some(v => v.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('CSV needs a header and at least one observation.');
  const header = rows.shift().map(s => s.trim());
  if (new Set(header).size !== header.length) throw new Error('CSV column names must be unique.');
  return rows.map((r, i) => {
    if (r.length !== header.length) throw new Error(`CSV row ${i + 2} has the wrong number of columns.`);
    return Object.fromEntries(header.map((key, j) => [key, r[j]]));
  });
}

export function importObservationsCSV(text, session) {
  const rows = parseCSV(text);
  if (rows.length > 30) throw new Error('Use at most 30 summarized observations.');
  const requiredNumber = (r, name) => {
    if (r[name] === undefined || !r[name].trim() || !Number.isFinite(Number(r[name]))) throw new Error(`Missing or invalid ${name}.`);
    return Number(r[name]);
  };
  const bssid = rows[0].bssid?.trim().toLowerCase();
  const channel = requiredNumber(rows[0], 'channel');
  if (!BSSID_PATTERN.test(bssid)) throw new Error('CSV needs a valid bssid column.');
  if (rows.some(r => r.bssid?.trim().toLowerCase() !== bssid || requiredNumber(r, 'channel') !== channel)) throw new Error('Import one BSSID and one channel per session.');
  const observations = rows.map((r, i) => {
    const hasGPS = Boolean(r.latitude?.trim() || r.longitude?.trim());
    const point = hasGPS ? toLocal(requiredNumber(r, 'latitude'), requiredNumber(r, 'longitude'), session.origin)
      : { x: requiredNumber(r, 'x_m'), y: requiredNumber(r, 'y_m') };
    return {
      id: r.id?.trim() || `M${i + 1}`, ...point,
      gpsAccuracyM: requiredNumber(r, 'gps_accuracy_m'), rssiDbm: requiredNumber(r, 'rssi_dbm'),
      bearingDeg: r.bearing_deg?.trim() ? requiredNumber(r, 'bearing_deg') : null,
      bearingUncertaintyDeg: r.bearing_tolerance_deg?.trim() ? requiredNumber(r, 'bearing_tolerance_deg') : null,
      enabled: r.enabled === undefined || r.enabled === '' ? true : r.enabled === 'true' ? true : r.enabled === 'false' ? false : (() => { throw new Error('enabled must be true or false.'); })(),
      timestamp: r.timestamp_utc?.trim() || '',
      sampleCount: requiredNumber(r, 'sample_count'), spreadDb: requiredNumber(r, 'spread_db'), notes: r.notes || '',
    };
  });
  // New receiver/target may invalidate calibration; never silently reuse it.
  const next = { ...structuredClone(session), source: 'field', truth: null,
    target: { bssid, channel, ssid: rows[0].ssid || '' }, observations,
    model: { ...session.model, calibrated: false } };
  return validateSession(next);
}

export function exportObservationsCSV(session) {
  const headers = ['id', 'bssid', 'ssid', 'channel', 'x_m', 'y_m', 'latitude', 'longitude', 'gps_accuracy_m', 'rssi_dbm', 'bearing_deg', 'bearing_tolerance_deg', 'timestamp_utc', 'sample_count', 'spread_db', 'enabled', 'notes'];
  const escape = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const rows = session.observations.map(o => {
    const gps = toGPS(o.x, o.y, session.origin);
    return [o.id, session.target.bssid, session.target.ssid, session.target.channel, o.x, o.y,
      gps.latitude.toFixed(9), gps.longitude.toFixed(9), o.gpsAccuracyM, o.rssiDbm,
      o.bearingDeg, o.bearingUncertaintyDeg, o.timestamp, o.sampleCount, o.spreadDb, o.enabled, o.notes];
  });
  return [headers.join(','), ...rows.map(row => row.map(escape).join(','))].join('\n');
}
