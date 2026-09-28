import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toLocal, toGPS, bearingTo, angleDifference, predictRSSI, distanceInterval,
  compatible, constraintsFor, solveRegion, makeDemoSession, validateSession,
  fitCalibration, summarizeSamples, importObservationsCSV, exportObservationsCSV,
} from '../demo/geometry.mjs';
import { assessTrial } from '../demo/trial-policy.mjs';

test('GPS conversion round-trips a small southern-hemisphere site and rejects distant points', () => {
  const origin = { latitude: -12.0464, longitude: -77.0428 };
  const gps = toGPS(120, 90, origin), point = toLocal(gps.latitude, gps.longitude, origin);
  assert.ok(Math.abs(point.x - 120) < 1e-6);
  assert.ok(Math.abs(point.y - 90) < 1e-6);
  assert.throws(() => toLocal(-13, -77, origin), /5 km/);
});

test('bearings use true north and wrap correctly across 360 degrees', () => {
  assert.equal(bearingTo({ x: 0, y: 0 }, { x: 0, y: 10 }), 0);
  assert.equal(bearingTo({ x: 0, y: 0 }, { x: 10, y: 0 }), 90);
  assert.equal(angleDifference(359, 1), 2);
  const o = { ...makeDemoSession().observations[0], x: 0, y: 0, gpsAccuracyM: 0, bearingDeg: 359, bearingUncertaintyDeg: 3 };
  assert.equal(compatible({ x: 0, y: 10 }, [{ observation: o }], 'bearing'), true);
  assert.equal(compatible({ x: 10, y: 0 }, [{ observation: o }], 'bearing'), false);
});

test('RSSI interval uses logarithmic distance with GPS expansion', () => {
  const model = { referenceDbm: -40, exponent: 2, toleranceDb: 6 };
  const o = { rssiDbm: -60, gpsAccuracyM: 2 };
  const interval = distanceInterval(o, model);
  assert.equal(interval.nominal, 10);
  assert.ok(Math.abs(interval.min - (10 ** .7 - 2)) < 1e-10);
  assert.ok(Math.abs(interval.max - (10 ** 1.3 + 2)) < 1e-10);
  assert.equal(distanceInterval({ rssiDbm: -10, gpsAccuracyM: 0 }, model), null);
});

test('independent calibration recovers a known propagation model', () => {
  const model = { referenceDbm: -38, exponent: 2.2 };
  const rows = [5, 10, 20, 40].map(distanceM => ({ distanceM, rssiDbm: predictRSSI(distanceM, model) }));
  const fit = fitCalibration(rows);
  assert.ok(Math.abs(fit.referenceDbm + 38) < 1e-9);
  assert.ok(Math.abs(fit.exponent - 2.2) < 1e-9);
  assert.ok(fit.rmsDb < 1e-9);
  assert.throws(() => fitCalibration([5, 5, 5].map(distanceM => ({ distanceM, rssiDbm: -55 }))), /different/);
});

test('simulated AP is inside every constraint mode; combining modes reduces area', () => {
  const s = makeDemoSession(); validateSession(s);
  const areas = {};
  for (const mode of ['rssi', 'bearing', 'combined']) {
    const result = solveRegion(s.observations, s.model, s.bounds, mode, 120);
    assert.equal(compatible(s.truth, result.constraints, mode), true);
    assert.ok(result.count > 0);
    assert.ok(Math.hypot(result.best.x - s.truth.x, result.best.y - s.truth.y) < 5);
    areas[mode] = result.area;
  }
  assert.ok(areas.combined <= areas.rssi && areas.combined <= areas.bearing);
});

test('adding a constraint cannot expand the compatible area; GPS uncertainty can expand it', () => {
  const s = makeDemoSession();
  const three = s.observations.map((o, i) => ({ ...o, enabled: i < 3 }));
  assert.ok(solveRegion(s.observations, s.model, s.bounds).area <= solveRegion(three, s.model, s.bounds).area);
  const noGPS = s.observations.map(o => ({ ...o, gpsAccuracyM: 0 }));
  assert.ok(solveRegion(noGPS, s.model, s.bounds).area <= solveRegion(s.observations, s.model, s.bounds).area);
});

test('contradictory observations produce an empty region instead of a forced fit', () => {
  const s = makeDemoSession(); s.model = { ...s.model, toleranceDb: .1 };
  const a = { ...s.observations[0], x: 10, y: 10, rssiDbm: -40, gpsAccuracyM: 0 };
  const b = { ...s.observations[1], x: 100, y: 80, rssiDbm: -40, gpsAccuracyM: 0 };
  const result = solveRegion([a, b], s.model, s.bounds);
  assert.equal(result.count, 0); assert.equal(result.best, null);
});

test('one broad ring flags plot clipping and missing bearings produce an actionable error', () => {
  const s = makeDemoSession();
  const wide = [{ ...s.observations[0], x: 60, y: 45, rssiDbm: -65, gpsAccuracyM: 100 }];
  assert.equal(solveRegion(wide, s.model, s.bounds).touchesBoundary, true);
  assert.throws(() => constraintsFor([{ ...s.observations[0], bearingDeg: null }], s.model, 'bearing'), /M1.*bearing/);
  assert.equal(solveRegion([], s.model, s.bounds).best, null);
});

test('changing the AP reference does not change the estimate', () => {
  const s = makeDemoSession();
  const first = solveRegion(s.observations, s.model, s.bounds);
  s.truth = { x: 5, y: 5, accuracyM: 100 };
  const second = solveRegion(s.observations, s.model, s.bounds);
  assert.deepEqual(first.best, second.best);
  assert.equal(first.area, second.area);
});

test('CSV round trip preserves metadata and resets field calibration and reference', () => {
  const s = makeDemoSession(); s.model.calibrated = true;
  s.observations[0].notes = 'Tree, "metal" fence\nsecond line';
  const imported = importObservationsCSV(exportObservationsCSV(s), s);
  assert.equal(imported.source, 'field'); assert.equal(imported.truth, null); assert.equal(imported.model.calibrated, false);
  assert.equal(imported.observations[0].notes, s.observations[0].notes);
  assert.ok(Math.abs(imported.observations[0].x - s.observations[0].x) < .001);
  assert.equal(imported.observations[0].sampleCount, 30);
  assert.throws(() => importObservationsCSV(exportObservationsCSV(s).replaceAll('"M2","02:00:00:00:00:01"', '"M2","02:00:00:00:00:02"'), s), /one BSSID/);
  assert.throws(() => importObservationsCSV('id,bssid,channel,rssi_dbm\nM1,02:00:00:00:00:01,6,-70', s), /x_m/);
});

test('metadata validation catches duplicate IDs, invalid units, and absent timestamps', () => {
  const s = makeDemoSession(); s.observations[1].id = 'M1';
  assert.throws(() => validateSession(s), /unique/);
  const bad = makeDemoSession(); bad.observations[0].rssiDbm = 10;
  assert.throws(() => validateSession(bad), /RSSI/);
  bad.observations[0].rssiDbm = -70; bad.observations[0].timestamp = '';
  assert.throws(() => validateSession(bad), /timestamp/);
});

test('sample summary is robust to an isolated outlier and trial policy requires reference containment', () => {
  assert.deepEqual(summarizeSamples([-70, -71, -70, -72, -20]), { median: -70, spreadDb: 1, sampleCount: 5 });
  const report = { stations: 4, areaM2: 100, errorM: 2, truthCompatible: false, clipped: false, calibrated: true };
  assert.match(assessTrial(report, { maxAreaM2: 600, maxErrorM: 10 }), /outside/);
  assert.match(assessTrial({ ...report, truthCompatible: true }, { maxAreaM2: 600, maxErrorM: 10 }), /criteria met/);
});
