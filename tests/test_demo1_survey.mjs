import test from 'node:test';
import assert from 'node:assert/strict';
import { toGPS, toLocal, predictRSSI } from '../demo-0/geometry.mjs';
import { emptySurvey, makeSurveyExample, validateSurvey, listNetworks, arrangeStations, estimateNetwork, evaluateReference, importStationsCSV, importSamplesCSV, summarizeSeries, geometryQuality, stationsCSV, samplesCSV } from '../demo-1/survey.mjs';
import { assessSeries } from '../demo-1/quality-policy.mjs';

test('AP coverage is grouped by BSSID/frequency and preserves identical SSIDs as different APs', () => {
  const s = makeSurveyExample(), networks = listNetworks(s);
  assert.equal(networks.length, 5);
  const twins = networks.filter(n => n.ssid === 'Field lab');
  assert.equal(twins.length, 2);
  assert.notEqual(twins[0].bssid, twins[1].bssid);
  assert.equal(twins.find(n => n.bssid.endsWith(':01')).detectedStations, 4);
  assert.equal(twins.find(n => n.bssid.endsWith(':05')).detectedStations, 1);
  const copy = { ...s.samples[0], frequencyMhz: 5180 };
  s.samples.push(copy);
  assert.equal(listNetworks(s).length, 6);
});

test('missing detections and too-short captures never become synthetic distances', () => {
  const s = makeSurveyExample(), networks = listNetworks(s), plane = arrangeStations(s.stations, s.paddingM);
  const sparse = networks.find(n => n.ssid === 'Sparse signal');
  assert.equal(sparse.usable.length, 2);
  assert.equal(sparse.stationSeries.filter(s => !s.summary).length, 2);
  assert.equal(estimateNetwork(sparse, plane), null);
  const brief = networks.find(n => n.ssid === 'Brief capture');
  assert.equal(brief.detectedStations, 3);
  assert.equal(brief.usable.length, 2);
  assert.match(brief.stationSeries.find(s => s.station.id === 'P3').quality.issues.join(' '), /Only 4 samples/);
  assert.equal(estimateNetwork(brief, plane), null);
});

test('four-station and three-station APs have estimable regions with independent reference containment', () => {
  const s = makeSurveyExample(), networks = listNetworks(s), plane = arrangeStations(s.stations, s.paddingM);
  for (const n of networks.filter(n => n.canEstimate)) {
    const result = estimateNetwork(n, plane), evaluation = evaluateReference(s.references[n.key], plane, result);
    assert.ok(result.count > 0);
    assert.equal(evaluation.inside, true);
    assert.ok(Number.isFinite(evaluation.errorM));
  }
  assert.equal(networks.filter(n => n.canEstimate).length, 2);
});

test('a noise-free known-model fixture locates the AP within one grid-cell diagonal', () => {
  const s = makeSurveyExample(), key = '02:00:00:00:00:01@2437';
  const plane = arrangeStations(s.stations, s.paddingM), reference = s.references[key];
  const truth = toLocal(reference.latitude, reference.longitude, plane.origin);
  for (const sample of s.samples.filter(row => row.bssid.endsWith(':01'))) {
    const station = plane.stations.find(row => row.id === sample.stationId);
    sample.rssiDbm = predictRSSI(Math.hypot(station.x - truth.x, station.y - truth.y), s.models[key]);
  }
  const result = estimateNetwork(listNetworks(s).find(n => n.key === key), plane);
  assert.ok(evaluateReference(reference, plane, result).errorM <= Math.SQRT2 * result.step);
});

test('automatic origin and estimate depend only on stations, never AP reference coordinates', () => {
  const s = makeSurveyExample(), plane = arrangeStations(s.stations, s.paddingM), network = listNetworks(s)[0];
  const first = estimateNetwork(network, plane);
  s.references[network.key] = { ...s.stations[0] };
  const again = arrangeStations(s.stations, s.paddingM);
  assert.deepEqual(plane, again);
  assert.deepEqual(first.best, estimateNetwork(listNetworks(s).find(n => n.key === network.key), again).best);
});

test('collinear and repeated stations fail the geometry gate', () => {
  assert.equal(geometryQuality([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]).usable, false);
  assert.equal(geometryQuality([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }]).distinct, 2);
  assert.equal(geometryQuality([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]).usable, true);
});

test('observed span excludes travel gaps between separate captures', () => {
  const s = makeSurveyExample(), base = s.samples[0];
  const samples = [
    { ...base, captureId: 'first', timestamp: '2026-09-28T12:00:00Z' },
    { ...base, captureId: 'first', timestamp: '2026-09-28T12:00:01Z' },
    { ...base, captureId: 'later', timestamp: '2026-09-28T13:00:00Z' },
    { ...base, captureId: 'later', timestamp: '2026-09-28T13:00:01Z' },
  ];
  const summary = summarizeSeries(samples);
  assert.equal(summary.spanSeconds, 2);
  assert.equal(summary.timeBins, 2);
  assert.equal(summary.elapsedSeconds, 3601);
  assert.equal(assessSeries(summary, s.limits).usable, false);
});

test('same-time bursts cannot pass duration and time-coverage criteria by count alone', () => {
  const s = makeSurveyExample(), burst = Array.from({ length: 100 }, () => ({ ...s.samples[0] }));
  const summary = summarizeSeries(burst), quality = assessSeries(summary, s.limits);
  assert.equal(summary.sampleCount, 100);
  assert.equal(summary.spanSeconds, 0);
  assert.equal(summary.timeBins, 1);
  assert.equal(quality.usable, false);
});

test('different receiver configurations block a cross-station estimate', () => {
  const s = makeSurveyExample();
  s.samples.filter(sample => sample.stationId === 'P2').forEach(sample => { sample.configId = 'different-gain-or-antenna'; });
  const network = listNetworks(s).find(n => n.bssid.endsWith(':01'));
  assert.equal(network.canEstimate, false);
  assert.equal(network.status, 'Receiver settings differ');
});

test('CSV imports join station/capture IDs and reject repeated capture ingestion', () => {
  const example = makeSurveyExample(), stations = importStationsCSV(stationsCSV(example), emptySurvey());
  const next = importSamplesCSV(samplesCSV(example), stations);
  assert.equal(next.samples.length, example.samples.length);
  assert.equal(listNetworks(next).length, 5);
  assert.equal(next.source, 'field');
  assert.equal(next.references[example.samples[0].bssid + '@2437'], undefined);
  assert.equal(listNetworks(next).find(n => n.bssid.endsWith(':01')).status, 'Exploratory · uncalibrated');
  assert.throws(() => importSamplesCSV(samplesCSV(example), next), /already imported/);
  assert.throws(() => importSamplesCSV(samplesCSV(example), emptySurvey()), /Unknown station/);
  assert.throws(() => importSamplesCSV(samplesCSV(example), stations, { stationId: 'P2' }), /conflicts/);
});

test('capture files without station IDs require explicit station selection', () => {
  const s = makeSurveyExample(), field = importStationsCSV(stationsCSV(s), emptySurvey());
  const csv = 'timestamp_utc,bssid,ssid,frequency_mhz,rssi_dbm,receiver_id,config_id\n2026-09-28T12:00:00Z,02:00:00:00:00:01,Lab,2437,-70,receiver-1,config-1';
  assert.throws(() => importSamplesCSV(csv, field, { captureId: 'test' }), /Unknown station/);
  const next = importSamplesCSV(csv, field, { stationId: 'P1', captureId: 'test' });
  assert.equal(next.samples[0].stationId, 'P1');
  assert.equal(next.samples[0].captureId, 'test');
});

test('one capture ID cannot refer to different locations', () => {
  const s = makeSurveyExample(); s.samples.find(sample => sample.stationId === 'P2').captureId = 'demo-P1';
  assert.throws(() => validateSurvey(s), /different stations/);
});

test('disabling a station reduces usable coverage without erasing its observations', () => {
  const s = makeSurveyExample(); s.stations.find(station => station.id === 'P2').enabled = false;
  const network = listNetworks(s).find(n => n.bssid.endsWith(':02'));
  assert.equal(network.detectedStations, 3);
  assert.equal(network.usable.length, 2);
  assert.equal(network.canEstimate, false);
});

test('validation rejects invalid signal units/ranges and oversized station extents', () => {
  const s = makeSurveyExample(); s.samples[0].rssiDbm = 10;
  assert.throws(() => validateSurvey(s), /RSSI/);
  const origin = { latitude: -12.04, longitude: -77.04 };
  const positions = [{ x: 0, y: 0 }, { x: 3500, y: 0 }].map((p, i) => ({ id: `P${i}`, ...toGPS(p.x, p.y, origin), accuracyM: 5, enabled: true, notes: '' }));
  assert.throws(() => arrangeStations(positions), /3 km/);
});
