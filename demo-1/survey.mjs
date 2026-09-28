import { BSSID_PATTERN, parseCSV, toLocal, toGPS, summarizeSamples, solveRegion, compatible, predictRSSI } from '../demo-0/geometry.mjs';
import { assessSeries } from './quality-policy.mjs';

export const DEFAULT_LIMITS = { minSamples: 30, minSpanSeconds: 10, minTimeBins: 3, binSeconds: 5, maxMadDb: 6 };
export const DEFAULT_MODEL = { referenceDbm: -38, exponent: 2.2, toleranceDb: 4, calibrated: false };
export const networkKey = sample => `${sample.bssid.toLowerCase()}@${sample.frequencyMhz}`;
const finite = (value, min, max, name) => {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name}: use a number between ${min} and ${max}.`);
};
function numeric(row, key) {
  if (row[key] === undefined || !String(row[key]).trim() || !Number.isFinite(Number(row[key]))) throw new Error(`Missing or invalid ${key}.`);
  return Number(row[key]);
}
function identifier(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new Error(`${name} must be nonempty text up to 100 characters.`);
  return value.trim();
}
function gps(value, name) {
  finite(value.latitude, -85, 85, `${name} latitude`);
  finite(value.longitude, -180, 180, `${name} longitude`);
  finite(value.accuracyM, 0, 500, `${name} GPS accuracy`);
}
function validModel(model) {
  finite(model.referenceDbm, -120, 0, 'Reference RSSI');
  finite(model.exponent, .5, 6, 'Path-loss exponent');
  finite(model.toleranceDb, .1, 30, 'RSSI tolerance');
  if (typeof model.calibrated !== 'boolean') throw new Error('Calibration flag must be true or false.');
}

export function emptySurvey() {
  return { version: 2, source: 'field', name: 'New field survey', stations: [], samples: [], models: {}, references: {}, limits: { ...DEFAULT_LIMITS }, paddingM: 25 };
}

export function validateSurvey(survey) {
  if (survey?.version !== 2) throw new Error('Import a demo-1 survey (version 2). Demo-0 sessions have a different schema.');
  if (!['synthetic', 'field'].includes(survey.source)) throw new Error('Invalid survey source.');
  identifier(survey.name, 'Survey name');
  if (!Array.isArray(survey.stations) || survey.stations.length > 30) throw new Error('Use at most 30 stations.');
  if (!Array.isArray(survey.samples) || survey.samples.length > 50000) throw new Error('Use at most 50,000 metadata samples per survey.');
  const ids = new Set();
  for (const station of survey.stations) {
    identifier(station.id, 'Station ID');
    if (ids.has(station.id)) throw new Error(`Duplicate station ID: ${station.id}.`);
    ids.add(station.id); gps(station, station.id);
    if (typeof station.enabled !== 'boolean') throw new Error(`${station.id}: enabled must be true or false.`);
    if (typeof station.notes !== 'string' || station.notes.length > 2000) throw new Error(`${station.id}: notes must be text up to 2,000 characters.`);
  }
  if (!survey.models || Array.isArray(survey.models) || typeof survey.models !== 'object'
      || !survey.references || Array.isArray(survey.references) || typeof survey.references !== 'object') throw new Error('Models and references must be objects.');
  const captureBindings = new Map();
  const keys = new Set();
  for (const sample of survey.samples) {
    if (!ids.has(sample.stationId)) throw new Error(`Unknown station ${sample.stationId}. Import its GPS position first.`);
    identifier(sample.captureId, 'Capture ID'); identifier(sample.receiverId, 'Receiver ID'); identifier(sample.configId, 'Receiver configuration ID');
    if (!BSSID_PATTERN.test(sample.bssid)) throw new Error('Samples need a valid BSSID.');
    finite(sample.frequencyMhz, 2300, 7200, 'Wi-Fi centre frequency (MHz)');
    if (!Number.isInteger(sample.frequencyMhz)) throw new Error('Frequency must be an integer MHz value.');
    finite(sample.rssiDbm, -127, 0, 'AP-specific RSSI (dBm)');
    if (typeof sample.ssid !== 'string' || sample.ssid.length > 100) throw new Error('SSID must be text up to 100 characters.');
    if (typeof sample.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(sample.timestamp) || !Number.isFinite(Date.parse(sample.timestamp))) throw new Error('Use an ISO sample timestamp with a timezone.');
    const binding = JSON.stringify([sample.stationId, sample.receiverId, sample.configId]);
    if (captureBindings.has(sample.captureId) && captureBindings.get(sample.captureId) !== binding) throw new Error(`Capture ${sample.captureId} is assigned to different stations or receiver settings.`);
    captureBindings.set(sample.captureId, binding);
    keys.add(networkKey(sample));
  }
  if (keys.size > 100) throw new Error('This demo supports at most 100 BSSID/frequency groups.');
  for (const [key, model] of Object.entries(survey.models)) {
    if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}@\d+$/i.test(key)) throw new Error('Invalid model BSSID/frequency key.');
    validModel(model);
  }
  const plane = survey.stations.length ? arrangeStations(survey.stations, survey.paddingM) : null;
  for (const [key, reference] of Object.entries(survey.references)) {
    if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}@\d+$/i.test(key)) throw new Error('Invalid reference BSSID/frequency key.');
    gps(reference, 'AP reference');
    if (plane) toLocal(reference.latitude, reference.longitude, plane.origin);
  }
  const l = survey.limits;
  if (!l) throw new Error('Collection criteria are missing.');
  finite(l.minSamples, 1, 10000, 'Minimum sample count');
  finite(l.minSpanSeconds, 0, 3600, 'Minimum observed span');
  finite(l.minTimeBins, 1, 1000, 'Minimum time bins');
  finite(l.binSeconds, .1, 300, 'Time bin duration');
  finite(l.maxMadDb, .1, 30, 'MAD review threshold');
  if (!Number.isInteger(l.minSamples) || !Number.isInteger(l.minTimeBins)) throw new Error('Sample and bin counts must be integers.');
  finite(survey.paddingM, 5, 1000, 'Plot margin');
  // Validate station geometry now, without using AP references for its bounds.
  return survey;
}

export function importStationsCSV(text, survey) {
  const rows = parseCSV(text), next = structuredClone(survey);
  const seen = new Set();
  for (const row of rows) {
    const id = identifier(row.station_id, 'station_id');
    if (seen.has(id)) throw new Error(`Duplicate GPS station ${id} in import.`);
    seen.add(id);
    const station = { id, latitude: numeric(row, 'latitude'), longitude: numeric(row, 'longitude'), accuracyM: numeric(row, 'gps_accuracy_m'), enabled: true, notes: row.notes || '' };
    const existing = next.stations.findIndex(s => s.id === id);
    if (existing >= 0) next.stations[existing] = { ...station, enabled: next.stations[existing].enabled };
    else next.stations.push(station);
  }
  return validateSurvey(next);
}

export function importSamplesCSV(text, survey, { stationId = '', captureId = '' } = {}) {
  if (text.length > 1000000) throw new Error('Split capture CSV files into batches smaller than 1 MB for this prototype.');
  const rows = parseCSV(text);
  const imported = rows.map(row => ({
    stationId: stationId || row.station_id?.trim() || '',
    captureId: row.capture_id?.trim() || captureId,
    receiverId: row.receiver_id?.trim() || '', configId: row.config_id?.trim() || '',
    timestamp: row.timestamp_utc?.trim() || '', bssid: row.bssid?.trim().toLowerCase() || '',
    ssid: row.ssid || '', frequencyMhz: numeric(row, 'frequency_mhz'), rssiDbm: numeric(row, 'rssi_dbm'),
  }));
  if (stationId && rows.some(r => r.station_id?.trim() && r.station_id.trim() !== stationId)) throw new Error('Selected station conflicts with the station_id inside the file.');
  const existingCaptures = new Set(survey.samples.map(s => s.captureId));
  for (const id of new Set(imported.map(s => s.captureId))) {
    if (existingCaptures.has(id)) throw new Error(`Capture ${id} is already imported. Remove it before replacing the file.`);
  }
  const next = { ...structuredClone(survey), source: 'field', samples: [...survey.samples, ...imported] };
  // A fresh capture cannot carry synthetic model/reference claims into a field survey.
  if (survey.source === 'synthetic') throw new Error('Start an empty field survey before importing real captures.');
  return validateSurvey(next);
}

export function arrangeStations(stations, paddingM = 25) {
  if (!stations.length) return { origin: null, bounds: { width: 120, height: 90 }, stations: [] };
  const anchor = { latitude: stations[0].latitude, longitude: stations[0].longitude };
  const local = stations.map(s => ({ ...s, ...toLocal(s.latitude, s.longitude, anchor) }));
  const minX = Math.min(...local.map(s => s.x)), minY = Math.min(...local.map(s => s.y));
  const origin = toGPS(minX - paddingM, minY - paddingM, anchor);
  const arranged = stations.map(s => ({ ...s, ...toLocal(s.latitude, s.longitude, origin) }));
  const width = Math.max(30, Math.max(...arranged.map(s => s.x)) + paddingM);
  const height = Math.max(30, Math.max(...arranged.map(s => s.y)) + paddingM);
  if (width > 3000 || height > 3000) throw new Error('Stations span more than this 3 km local plotting demo supports.');
  return { origin, bounds: { width, height }, stations: arranged };
}

export function summarizeSeries(samples, binSeconds = 5) {
  const ordered = [...samples].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const first = Date.parse(ordered[0].timestamp), last = Date.parse(ordered.at(-1).timestamp);
  const stats = summarizeSamples(ordered.map(s => s.rssiDbm));
  const captureStarts = new Map();
  for (const s of ordered) if (!captureStarts.has(s.captureId)) captureStarts.set(s.captureId, Date.parse(s.timestamp));
  const bins = new Set(ordered.map(s => `${s.captureId}:${Math.floor((Date.parse(s.timestamp) - captureStarts.get(s.captureId)) / (binSeconds * 1000))}`));
  // Span within captures, excluding travel gaps between visits.
  const spans = [...captureStarts].map(([id, start]) => {
    const end = Math.max(...ordered.filter(s => s.captureId === id).map(s => Date.parse(s.timestamp)));
    return (end - start) / 1000;
  });
  return { ...stats, medianDbm: stats.median, spanSeconds: spans.reduce((a, b) => a + b, 0), timeBins: bins.size,
    firstTimestamp: ordered[0].timestamp, lastTimestamp: ordered.at(-1).timestamp,
    receiverConfigs: [...new Set(ordered.map(s => JSON.stringify([s.receiverId, s.configId])))],
    captures: [...captureStarts.keys()], elapsedSeconds: (last - first) / 1000 };
}

export function geometryQuality(stations) {
  const distinct = [...new Map(stations.map(s => [`${s.x.toFixed(2)},${s.y.toFixed(2)}`, s])).values()];
  if (distinct.length < 3) return { usable: false, distinct: distinct.length, reason: 'Need at least three distinct usable station positions.' };
  const mx = distinct.reduce((a, s) => a + s.x, 0) / distinct.length, my = distinct.reduce((a, s) => a + s.y, 0) / distinct.length;
  const xx = distinct.reduce((a, s) => a + (s.x - mx) ** 2, 0), yy = distinct.reduce((a, s) => a + (s.y - my) ** 2, 0), xy = distinct.reduce((a, s) => a + (s.x - mx) * (s.y - my), 0);
  const total = xx + yy, disc = Math.hypot(xx - yy, 2 * xy);
  const ratio = (total - disc) / Math.max(1e-12, total + disc);
  return { usable: ratio >= .01, distinct: distinct.length, reason: ratio < .01 ? 'Stations are collinear or nearly collinear; improve geometry.' : '', ratio };
}

export function listNetworks(survey) {
  const groups = new Map();
  for (const sample of survey.samples) {
    const key = networkKey(sample);
    if (!groups.has(key)) groups.set(key, { key, bssid: sample.bssid, frequencyMhz: sample.frequencyMhz, ssids: new Set(), byStation: new Map() });
    const group = groups.get(key); if (sample.ssid) group.ssids.add(sample.ssid);
    if (!group.byStation.has(sample.stationId)) group.byStation.set(sample.stationId, []);
    group.byStation.get(sample.stationId).push(sample);
  }
  const plane = arrangeStations(survey.stations, survey.paddingM);
  return [...groups.values()].map(group => {
    const stationSeries = plane.stations.map(station => {
      const samples = group.byStation.get(station.id);
      if (!samples) return { station, summary: null, quality: { usable: false, issues: ['Not observed at this station.'] } };
      const summary = summarizeSeries(samples, survey.limits.binSeconds), quality = assessSeries(summary, survey.limits);
      return { station, summary, quality };
    });
    const usable = stationSeries.filter(s => s.station.enabled && s.summary && s.quality.usable);
    const receiverConfigs = new Set(usable.flatMap(s => s.summary.receiverConfigs));
    const geometry = geometryQuality(usable.map(s => s.station));
    const status = receiverConfigs.size > 1 ? 'Receiver settings differ' : !geometry.usable
      ? geometry.distinct < 3 ? 'Too few usable stations' : 'Weak station geometry'
      : survey.source === 'field' && !survey.models[group.key]?.calibrated ? 'Exploratory · uncalibrated' : 'Ready to estimate';
    return { ...group, ssids: [...group.ssids], ssid: [...group.ssids][0] || '(hidden SSID)', stationSeries, usable, geometry, status,
      canEstimate: receiverConfigs.size <= 1 && geometry.usable, detectedStations: stationSeries.filter(s => s.summary).length,
      totalSamples: [...group.byStation.values()].reduce((sum, s) => sum + s.length, 0), model: survey.models[group.key] || { ...DEFAULT_MODEL } };
  }).sort((a, b) => Number(b.canEstimate) - Number(a.canEstimate) || a.ssid.localeCompare(b.ssid) || a.key.localeCompare(b.key));
}

export function estimateNetwork(network, plane) {
  if (!network.canEstimate) return null;
  const observations = network.usable.map(({ station, summary }) => ({
    id: station.id, x: station.x, y: station.y, gpsAccuracyM: station.accuracyM, rssiDbm: summary.medianDbm,
    bearingDeg: null, bearingUncertaintyDeg: null, enabled: true,
  }));
  return solveRegion(observations, network.model, plane.bounds, 'rssi');
}

export function evaluateReference(reference, plane, result) {
  if (!reference || !plane.origin || !result) return null;
  const point = toLocal(reference.latitude, reference.longitude, plane.origin);
  return { point, accuracyM: reference.accuracyM,
    inside: compatible(point, result.constraints, 'rssi'),
    inPlot: point.x >= 0 && point.y >= 0 && point.x <= plane.bounds.width && point.y <= plane.bounds.height,
    errorM: result.best ? Math.hypot(result.best.x - point.x, result.best.y - point.y) : null };
}

export function makeSurveyExample() {
  const s = emptySurvey(); s.source = 'synthetic'; s.name = 'Four-station coverage experiment';
  const origin = { latitude: -12.0464, longitude: -77.0428 };
  const locations = [{ x: 14, y: 12 }, { x: 15, y: 76 }, { x: 105, y: 75 }, { x: 106, y: 13 }];
  s.stations = locations.map((p, i) => ({ id: `P${i + 1}`, ...toGPS(p.x, p.y, origin), accuracyM: 2, enabled: true, notes: 'Simulated GPS position.' }));
  const aps = [
    { bssid: '02:00:00:00:00:01', ssid: 'Field lab', x: 64, y: 46, stationIndices: [0, 1, 2, 3] },
    { bssid: '02:00:00:00:00:02', ssid: 'Ridge station', x: 77, y: 54, stationIndices: [0, 1, 2] },
    { bssid: '02:00:00:00:00:03', ssid: 'Sparse signal', x: 45, y: 32, stationIndices: [0, 3] },
    { bssid: '02:00:00:00:00:04', ssid: 'Brief capture', x: 57, y: 65, stationIndices: [0, 1, 2], briefStation: 2 },
    { bssid: '02:00:00:00:00:05', ssid: 'Field lab', x: 30, y: 70, stationIndices: [1] },
  ];
  for (const ap of aps) {
    const key = `${ap.bssid}@2437`; s.models[key] = { ...DEFAULT_MODEL, toleranceDb: 3 };
    s.references[key] = { ...toGPS(ap.x, ap.y, origin), accuracyM: 2 };
    for (const i of ap.stationIndices) {
      const nominal = predictRSSI(Math.hypot(locations[i].x - ap.x, locations[i].y - ap.y), s.models[key]);
      const count = ap.briefStation === i ? 4 : 45;
      for (let j = 0; j < count; j++) s.samples.push({
        stationId: `P${i + 1}`, captureId: `demo-P${i + 1}`, receiverId: 'simulated-receiver', configId: 'omni-fixed-settings',
        timestamp: new Date(Date.UTC(2026, 8, 28, 12, i * 2) + j * 500).toISOString(),
        bssid: ap.bssid, ssid: ap.ssid, frequencyMhz: 2437,
        rssiDbm: Math.round((nominal + [.6, -1.1, .8, -.4][i] + Math.sin(j * 1.7) * 1.5) * 10) / 10,
      });
    }
  }
  return validateSurvey(s);
}

export function exportCSV(rows, columns) {
  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns.join(','), ...rows.map(row => columns.map(key => escape(row[key])).join(','))].join('\n');
}

export function samplesCSV(survey) {
  return exportCSV(survey.samples.map(s => ({ station_id: s.stationId, capture_id: s.captureId, receiver_id: s.receiverId, config_id: s.configId, timestamp_utc: s.timestamp, bssid: s.bssid, ssid: s.ssid, frequency_mhz: s.frequencyMhz, rssi_dbm: s.rssiDbm })),
    ['station_id', 'capture_id', 'receiver_id', 'config_id', 'timestamp_utc', 'bssid', 'ssid', 'frequency_mhz', 'rssi_dbm']);
}

export function stationsCSV(survey) {
  return exportCSV(survey.stations.map(s => ({ station_id: s.id, latitude: s.latitude, longitude: s.longitude, gps_accuracy_m: s.accuracyM, notes: s.notes })), ['station_id', 'latitude', 'longitude', 'gps_accuracy_m', 'notes']);
}
