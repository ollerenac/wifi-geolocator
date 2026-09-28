import {
  makeDemoSession, validateSession, toLocal, toGPS, solveRegion, compatible,
  distinctStationCount, fitCalibration, summarizeSamples,
  importObservationsCSV, exportObservationsCSV,
} from './geometry.mjs';
import { assessTrial } from './trial-policy.mjs';

const $ = id => document.getElementById(id);
const colors = ['#2459a6', '#a45c21', '#7d4aa3', '#137f80', '#a64064', '#526e29'];
const ns = 'http://www.w3.org/2000/svg';
let session = makeDemoSession();
let selectedId = session.observations[0].id;
let mode = 'rssi';
let lastResult = null;
let lastReport = null;

function svgNode(name, attrs = {}, text) {
  const element = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

function showMessage(message) {
  $('message').textContent = message;
  $('message').hidden = !message;
}

function number(id) {
  const raw = $(id).value.trim();
  if (!raw || !Number.isFinite(Number(raw))) throw new Error(`Enter a valid value for ${$(id).closest('label')?.childNodes[0]?.textContent?.trim() || id}.`);
  return Number(raw);
}

function optionalNumber(id) { return $(id).value.trim() ? number(id) : null; }
function setValue(id, value) { $(id).value = value ?? ''; }
function guarded(action) {
  return async event => {
    event?.preventDefault();
    try { await action(event); showMessage(''); }
    catch (error) { showMessage(error.message || String(error)); }
  };
}

function commit(next, nextSelectedId = selectedId) {
  validateSession(next);
  session = next;
  selectedId = session.observations.some(o => o.id === nextSelectedId)
    ? nextSelectedId : session.observations[0]?.id ?? null;
  render();
}

function renderForms() {
  setValue('ssid', session.target.ssid); setValue('bssid', session.target.bssid); setValue('channel', session.target.channel);
  setValue('reference', session.model.referenceDbm); setValue('exponent', session.model.exponent); setValue('tolerance', session.model.toleranceDb);
  $('calibrated').checked = session.model.calibrated;
  $('calibration-status').textContent = session.source === 'synthetic' ? 'Synthetic model parameters'
    : session.model.calibrated ? 'Calibration recorded; validate independently' : 'Field model is not calibrated';
  setValue('origin-lat', session.origin.latitude); setValue('origin-lon', session.origin.longitude);
  setValue('width', session.bounds.width); setValue('height', session.bounds.height);
  $('has-truth').checked = Boolean(session.truth);
  setValue('truth-x', session.truth?.x); setValue('truth-y', session.truth?.y); setValue('truth-accuracy', session.truth?.accuracyM);
  const truthGPS = session.truth ? toGPS(session.truth.x, session.truth.y, session.origin) : null;
  setValue('truth-lat', truthGPS?.latitude.toFixed(9)); setValue('truth-lon', truthGPS?.longitude.toFixed(9));
  $('source-badge').textContent = session.source === 'synthetic' ? 'Simulated observations' : 'Field observations · manual / imported';
  $('source-badge').classList.toggle('field', session.source === 'field');
  $('plot-description').textContent = `${session.bounds.width} × ${session.bounds.height} m · origin ${session.origin.latitude.toFixed(5)}, ${session.origin.longitude.toFixed(5)}`;
  renderEditor();
}

function renderEditor() {
  const observation = session.observations.find(o => o.id === selectedId);
  $('editor-title').textContent = observation ? `Edit ${observation.id}` : 'Add your first station';
  for (const element of $('observation-form').elements) element.disabled = !observation;
  if (!observation) { $('observation-form').reset(); return; }
  const gps = toGPS(observation.x, observation.y, session.origin);
  const values = {
    'obs-x': observation.x, 'obs-y': observation.y, 'obs-gps': observation.gpsAccuracyM,
    'obs-rssi': observation.rssiDbm, 'obs-count': observation.sampleCount, 'obs-spread': observation.spreadDb,
    'obs-time': observation.timestamp, 'obs-notes': observation.notes,
    'obs-bearing': observation.bearingDeg, 'obs-angle': observation.bearingUncertaintyDeg,
    'obs-lat': gps.latitude.toFixed(9), 'obs-lon': gps.longitude.toFixed(9), 'obs-samples': '',
  };
  for (const [id, value] of Object.entries(values)) setValue(id, value);
}

function renderStations() {
  $('station-list').replaceChildren();
  if (!session.observations.length) {
    const empty = document.createElement('p'); empty.className = 'small';
    empty.textContent = 'No measurements yet. Add a station or import a CSV.';
    $('station-list').append(empty);
  }
  session.observations.forEach((o, i) => {
    const row = document.createElement('div');
    row.className = `station-row${selectedId === o.id ? ' selected' : ''}`;
    row.style.setProperty('--station', colors[i % colors.length]);
    const label = document.createElement('label');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = o.enabled;
    checkbox.setAttribute('aria-label', `Use ${o.id} in estimate`);
    checkbox.addEventListener('change', () => { o.enabled = checkbox.checked; renderEstimate(); });
    label.append(checkbox);
    const button = document.createElement('button'); button.type = 'button';
    button.setAttribute('aria-label', `Edit ${o.id}`); button.setAttribute('aria-pressed', selectedId === o.id ? 'true' : 'false');
    const id = document.createElement('strong'); id.textContent = o.id;
    const power = document.createElement('span'); power.className = 'power'; power.textContent = `${o.rssiDbm.toFixed(1)} dBm`;
    const detail = document.createElement('small'); detail.textContent = `(${o.x.toFixed(1)}, ${o.y.toFixed(1)}) m · GPS ±${o.gpsAccuracyM} m`;
    button.append(id, power, detail);
    button.addEventListener('click', () => { selectedId = o.id; renderStations(); renderEditor(); });
    row.append(label, button); $('station-list').append(row);
  });
}

function drawPlot(result) {
  const plot = $('plot'); plot.replaceChildren();
  plot.append(svgNode('title', { id: 'plot-title' }, 'Wi-Fi access-point positioning experiment'));
  plot.append(svgNode('desc', { id: 'plot-desc' }, `${session.source === 'synthetic' ? 'Simulated' : 'Field'} data. East and north in metres. ${session.observations.filter(o => o.enabled).length} selected observations. ${result ? `${result.area.toFixed(1)} square metres of sampled compatible area.` : 'Unable to estimate; check measurement inputs.'}`));
  const style = svgNode('style', {}, 'text{font-family:Segoe UI,Arial,sans-serif;fill:#173044} .tick{fill:#526b7d;font-size:12px} .plot-label{font-size:13px}'); plot.append(style);
  const scale = Math.min(750 / session.bounds.width, 550 / session.bounds.height);
  const w = session.bounds.width * scale, h = session.bounds.height * scale;
  const x0 = 78 + (750 - w) / 2, y0 = 610;
  const X = x => x0 + x * scale, Y = y => y0 - y * scale;
  const defs = svgNode('defs'); const clip = svgNode('clipPath', { id: 'site-clip' });
  clip.append(svgNode('rect', { x: x0, y: y0 - h, width: w, height: h })); defs.append(clip); plot.append(defs);
  plot.append(svgNode('rect', { x: x0, y: y0 - h, width: w, height: h, fill: '#f6faff', stroke: '#a7bfce', 'stroke-width': 1.4 }));
  const tickStep = maximum => {
    const raw = maximum / 6, base = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].find(v => v * base >= raw) * base;
  };
  const dx = tickStep(session.bounds.width), dy = tickStep(session.bounds.height);
  for (let x = 0; x <= session.bounds.width + 1e-8; x += dx) {
    plot.append(svgNode('line', { x1: X(x), y1: Y(0), x2: X(x), y2: Y(session.bounds.height), stroke: '#dbe6ef', 'stroke-width': 1 }));
    plot.append(svgNode('text', { x: X(x), y: y0 + 23, 'text-anchor': 'middle', class: 'tick' }, String(Math.round(x * 100) / 100)));
  }
  for (let y = 0; y <= session.bounds.height + 1e-8; y += dy) {
    plot.append(svgNode('line', { x1: X(0), y1: Y(y), x2: X(session.bounds.width), y2: Y(y), stroke: '#dbe6ef', 'stroke-width': 1 }));
    plot.append(svgNode('text', { x: x0 - 14, y: Y(y) + 4, 'text-anchor': 'end', class: 'tick' }, String(Math.round(y * 100) / 100)));
  }
  plot.append(svgNode('text', { x: x0 + w / 2, y: y0 + 52, 'text-anchor': 'middle', class: 'plot-label' }, 'East x (metres)'));
  plot.append(svgNode('text', { x: x0 - 53, y: y0 - h / 2, transform: `rotate(-90 ${x0 - 53} ${y0 - h / 2})`, 'text-anchor': 'middle', class: 'plot-label' }, 'North y (metres)'));
  plot.append(svgNode('text', { x: x0, y: y0 - h - 18, class: 'tick' }, 'Local plane · true north ↑'));
  const overlays = svgNode('g', { 'clip-path': 'url(#site-clip)' });
  if (result && $('show-constraints').checked) {
    result.constraints.forEach(({ observation: o, interval }) => {
      const index = session.observations.findIndex(p => p.id === o.id), color = colors[index % colors.length];
      const radiusCap = Math.hypot(session.bounds.width, session.bounds.height) * 2;
      if (mode !== 'bearing' && interval && interval.min <= radiusCap) {
        const cx = X(o.x), cy = Y(o.y), outer = Math.min(interval.max, radiusCap) * scale, inner = interval.min * scale;
        const circlePath = radius => radius ? `M${cx - radius},${cy}a${radius},${radius} 0 1 0 ${radius * 2},0a${radius},${radius} 0 1 0 ${-radius * 2},0Z` : '';
        overlays.append(svgNode('path', { d: circlePath(outer) + circlePath(inner), fill: color, 'fill-opacity': 0.055, 'fill-rule': 'evenodd' }));
        for (const radius of [interval.min, interval.max]) {
          if (radius < radiusCap) overlays.append(svgNode('circle', { cx, cy, r: radius * scale, fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-opacity': .55, 'stroke-dasharray': '6 5' }));
        }
      }
      if (mode !== 'rssi') {
        const points = [[X(o.x), Y(o.y)]];
        for (let i = 0; i <= 40; i++) {
          const angle = (o.bearingDeg - o.bearingUncertaintyDeg + 2 * o.bearingUncertaintyDeg * i / 40) * Math.PI / 180;
          points.push([X(o.x + radiusCap * Math.sin(angle)), Y(o.y + radiusCap * Math.cos(angle))]);
        }
        overlays.append(svgNode('polygon', { points: points.map(p => p.join(',')).join(' '), fill: color, 'fill-opacity': .06 }));
        for (const angle of [o.bearingDeg - o.bearingUncertaintyDeg, o.bearingDeg + o.bearingUncertaintyDeg]) {
          const rad = angle * Math.PI / 180;
          overlays.append(svgNode('line', { x1: X(o.x), y1: Y(o.y), x2: X(o.x + radiusCap * Math.sin(rad)), y2: Y(o.y + radiusCap * Math.cos(rad)), stroke: color, 'stroke-opacity': .65, 'stroke-dasharray': '6 5' }));
        }
      }
    });
  }
  if (result?.runs.length) {
    const path = result.runs.map(r => `M${X(r.x)},${Y(r.y + r.height)}h${r.width * scale}v${r.height * scale}h${-r.width * scale}Z`).join('');
    overlays.append(svgNode('path', { d: path, fill: '#137f80', 'fill-opacity': .36 }));
  }
  plot.append(overlays);
  session.observations.forEach((o, i) => {
    const group = svgNode('g', { opacity: o.enabled ? 1 : .35 });
    group.append(svgNode('title', {}, `${o.id}: x ${o.x.toFixed(1)} m, y ${o.y.toFixed(1)} m; ${o.rssiDbm} dBm; GPS ±${o.gpsAccuracyM} m`));
    const gps = svgNode('circle', { cx: X(o.x), cy: Y(o.y), r: o.gpsAccuracyM * scale, fill: colors[i % colors.length], 'fill-opacity': .07, stroke: colors[i % colors.length], 'stroke-opacity': .25 });
    const marker = svgNode('rect', { x: X(o.x) - 5, y: Y(o.y) - 5, width: 10, height: 10, fill: colors[i % colors.length], stroke: 'white', 'stroke-width': 1.5 });
    const alignRight = o.x > session.bounds.width * .65;
    const textX = X(o.x) + (alignRight ? -12 : 12), textY = Y(o.y) - 7;
    group.append(gps, marker, svgNode('text', { x: textX, y: textY, 'text-anchor': alignRight ? 'end' : 'start', 'font-size': 14, 'font-weight': 650 }, o.id));
    group.append(svgNode('text', { x: textX, y: textY + 17, 'text-anchor': alignRight ? 'end' : 'start', class: 'tick' }, `${o.rssiDbm.toFixed(1)} dBm`));
    plot.append(group);
  });
  if (session.truth && $('show-truth').checked) {
    const x = X(session.truth.x), y = Y(session.truth.y);
    plot.append(svgNode('circle', { cx: x, cy: y, r: session.truth.accuracyM * scale, fill: 'none', stroke: '#173044', 'stroke-opacity': .3, 'stroke-dasharray': '2 3' }));
    plot.append(svgNode('rect', { x: x - 7, y: y - 7, width: 14, height: 14, rx: 2, fill: '#173044', stroke: 'white', 'stroke-width': 2 }));
    plot.append(svgNode('text', { x: x + 14, y: y - 8, 'font-size': 13, 'font-weight': 650 }, 'Known AP'));
  }
  if (result?.best) {
    const x = X(result.best.x), y = Y(result.best.y);
    plot.append(svgNode('path', { d: `M${x},${y - 7}l7,7l-7,7l-7,-7Z`, fill: '#fff', stroke: '#173044', 'stroke-width': 2 }));
  }
  const provenance = session.source === 'synthetic' ? 'Simulated observations' : 'Field observations';
  plot.append(svgNode('text', { x: x0, y: 691, class: 'tick' }, `${provenance} · ${session.target.bssid} · channel ${session.target.channel} · ${mode}`));
}

function renderTrial() {
  if (!lastReport) { $('trial-status').textContent = 'No estimate available.'; return; }
  const maxAreaM2 = Number($('max-area').value), maxErrorM = Number($('max-error').value);
  if (!Number.isFinite(maxAreaM2) || maxAreaM2 <= 0 || !Number.isFinite(maxErrorM) || maxErrorM <= 0) {
    $('trial-status').textContent = 'Enter positive area and position-error limits.'; return;
  }
  const report = { ...lastReport, calibrated: mode === 'bearing' || session.source === 'synthetic' || session.model.calibrated };
  $('trial-status').textContent = (session.source === 'synthetic' ? 'Simulation only: ' : '') + assessTrial(report, { maxAreaM2, maxErrorM });
}

function renderEstimate() {
  let result = null, error = null;
  try { result = solveRegion(session.observations, session.model, session.bounds, mode); }
  catch (err) { error = err; }
  lastResult = result;
  drawPlot(result);
  const distinct = distinctStationCount(session.observations);
  const errorM = result?.best && session.truth ? Math.hypot(result.best.x - session.truth.x, result.best.y - session.truth.y) : null;
  const truthCompatible = result?.constraints.length && session.truth ? compatible(session.truth, result.constraints, mode) : null;
  $('area-result').textContent = result ? `≈ ${Math.round(result.area).toLocaleString()} m²` : '—';
  $('grid-result').textContent = result ? `${result.step.toFixed(2)} m sampling grid · ${distinct} distinct stations` : '';
  $('fit-result').textContent = result?.best ? `${result.best.x.toFixed(1)}, ${result.best.y.toFixed(1)} m` : 'No fit';
  const gps = result?.best ? toGPS(result.best.x, result.best.y, session.origin) : null;
  $('fit-gps').textContent = gps ? `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}` : 'No compatible sampled cell';
  $('error-result').textContent = errorM !== null ? `${errorM.toFixed(1)} m` : session.truth ? 'Unavailable' : 'No reference';
  $('truth-result').textContent = session.truth ? `Known AP ±${session.truth.accuracyM} m · ${truthCompatible === null ? 'not evaluated' : truthCompatible ? 'inside constraints' : 'outside constraints'}` : 'Add the independent AP position to evaluate';
  const messages = [];
  if (error) messages.push(error.message);
  else if (!distinct) messages.push('Add and select measurements to begin.');
  else {
    if (distinct < 3) messages.push('Exploration only: use at least three distinct station positions.');
    if (!result.count) messages.push('No sampled overlap. Check calibration, observations, tolerances, plot bounds and grid resolution.');
    if (result.touchesBoundary) messages.push('Region reaches the plot boundary; its full area may be larger.');
    if (session.source === 'field' && mode !== 'bearing' && !session.model.calibrated) messages.push('Uncalibrated RSSI model: results are exploratory.');
    if (!messages.length) messages.push('Measurements have a compatible overlap. Validate against the AP reference and repeat the trial.');
  }
  if (mode !== 'rssi') messages.push('Dashed wedges show nominal angular limits; the overlap also includes station GPS uncertainty.');
  $('diagnostic').textContent = messages.join(' ');
  $('diagnostic').classList.toggle('warning', Boolean(error) || distinct < 3 || !result?.count || result?.touchesBoundary || (session.source === 'field' && mode !== 'bearing' && !session.model.calibrated));
  lastReport = result ? { stations: distinct, areaM2: result.area, errorM, truthCompatible, clipped: result.touchesBoundary } : null;
  renderTrial();
}

function render() { renderForms(); renderStations(); renderEstimate(); }

function download(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('target-form').addEventListener('submit', guarded(() => {
  const next = structuredClone(session);
  next.target = { ssid: $('ssid').value, bssid: $('bssid').value.trim().toLowerCase(), channel: number('channel') };
  if (next.target.bssid !== session.target.bssid || next.target.channel !== session.target.channel) {
    if (session.observations.length) throw new Error('Start a new field session before changing the BSSID or channel; existing observations belong to this target.');
    next.model.calibrated = false;
  }
  commit(next);
}));

$('observation-form').addEventListener('submit', guarded(() => {
  const next = structuredClone(session), o = next.observations.find(p => p.id === selectedId);
  Object.assign(o, {
    x: number('obs-x'), y: number('obs-y'), gpsAccuracyM: number('obs-gps'), rssiDbm: number('obs-rssi'),
    bearingDeg: optionalNumber('obs-bearing'), bearingUncertaintyDeg: optionalNumber('obs-angle'),
    timestamp: $('obs-time').value.trim(), sampleCount: number('obs-count'), spreadDb: number('obs-spread'), notes: $('obs-notes').value,
  });
  commit(next);
}));

$('convert-gps').addEventListener('click', guarded(() => {
  const point = toLocal(number('obs-lat'), number('obs-lon'), session.origin);
  if (point.x < 0 || point.x > session.bounds.width || point.y < 0 || point.y > session.bounds.height) throw new Error('GPS point is outside the plot. Set a southwest origin and suitable bounds first.');
  setValue('obs-x', Number(point.x.toFixed(3))); setValue('obs-y', Number(point.y.toFixed(3)));
}));

$('convert-truth-gps').addEventListener('click', guarded(() => {
  if (number('origin-lat') !== session.origin.latitude || number('origin-lon') !== session.origin.longitude) {
    throw new Error('Apply the new origin before converting the AP GPS coordinate.');
  }
  const point = toLocal(number('truth-lat'), number('truth-lon'), session.origin);
  if (point.x < 0 || point.x > session.bounds.width || point.y < 0 || point.y > session.bounds.height) throw new Error('AP GPS coordinate is outside the plot. Set suitable origin and bounds first.');
  setValue('truth-x', Number(point.x.toFixed(3))); setValue('truth-y', Number(point.y.toFixed(3)));
  $('has-truth').checked = true;
}));

$('summarize-samples').addEventListener('click', guarded(() => {
  const text = $('obs-samples').value.trim().replaceAll('−', '-');
  if (!text) throw new Error('Enter RSSI samples first.');
  const samples = text.split(/[\s,;]+/).filter(Boolean).map(Number);
  const summary = summarizeSamples(samples);
  setValue('obs-rssi', summary.median); setValue('obs-count', summary.sampleCount); setValue('obs-spread', summary.spreadDb);
}));

$('add-station').addEventListener('click', guarded(() => {
  if (session.observations.length >= 30) throw new Error('Use at most 30 stations per session.');
  const next = structuredClone(session); let index = 1;
  while (next.observations.some(o => o.id === `M${index}`)) index++;
  const id = `M${index}`;
  next.observations.push({ id, x: session.bounds.width / 2, y: session.bounds.height / 2,
    gpsAccuracyM: 5, rssiDbm: -70, bearingDeg: null, bearingUncertaintyDeg: null, enabled: false,
    timestamp: new Date().toISOString(), sampleCount: 1, spreadDb: 0,
    notes: 'Draft station. Enter a measurement, then select its checkbox to include it.',
  });
  commit(next, id);
}));

$('remove-station').addEventListener('click', guarded(() => {
  const next = structuredClone(session); next.observations = next.observations.filter(o => o.id !== selectedId); commit(next);
}));

$('model-form').addEventListener('submit', guarded(() => {
  const next = structuredClone(session);
  next.model = { referenceDbm: number('reference'), exponent: number('exponent'), toleranceDb: number('tolerance'), calibrated: $('calibrated').checked };
  commit(next);
}));

$('fit-calibration').addEventListener('click', guarded(() => {
  const rows = $('calibration-pairs').value.trim().replaceAll('−', '-').split('\n').filter(s => s.trim()).map(line => {
    const values = line.trim().split(/[\s,;]+/);
    if (values.length !== 2) throw new Error('Use one distance, RSSI pair per line.');
    return { distanceM: Number(values[0]), rssiDbm: Number(values[1]) };
  });
  const fit = fitCalibration(rows), next = structuredClone(session);
  next.model.referenceDbm = Number(fit.referenceDbm.toFixed(4)); next.model.exponent = Number(fit.exponent.toFixed(4));
  next.model.calibrated = false;
  commit(next);
  $('calibration-status').textContent = `Fit RMS ${fit.rmsDb.toFixed(2)} dB. Check separate validation data before marking calibrated.`;
}));

$('geometry-form').addEventListener('submit', guarded(() => {
  const next = structuredClone(session);
  const newOrigin = { latitude: number('origin-lat'), longitude: number('origin-lon') };
  if (newOrigin.latitude !== session.origin.latitude || newOrigin.longitude !== session.origin.longitude) {
    next.observations = next.observations.map(o => {
      const gps = toGPS(o.x, o.y, session.origin);
      return { ...o, ...toLocal(gps.latitude, gps.longitude, newOrigin) };
    });
    if (session.truth && $('has-truth').checked) {
      const p = toGPS(session.truth.x, session.truth.y, session.origin);
      const local = toLocal(p.latitude, p.longitude, newOrigin);
      // Reference form values are in the old coordinate frame unless explicitly edited.
      if (number('truth-x') === session.truth.x && number('truth-y') === session.truth.y) {
        setValue('truth-x', local.x); setValue('truth-y', local.y);
      }
    }
  }
  next.origin = newOrigin;
  next.bounds = { width: number('width'), height: number('height') };
  next.truth = $('has-truth').checked ? { x: number('truth-x'), y: number('truth-y'), accuracyM: number('truth-accuracy') } : null;
  commit(next);
}));

$('mode').addEventListener('change', () => { mode = $('mode').value; renderEstimate(); });
for (const id of ['show-truth', 'show-constraints']) $(id).addEventListener('change', () => drawPlot(lastResult));
for (const id of ['max-area', 'max-error']) $(id).addEventListener('input', renderTrial);
$('load-demo').addEventListener('click', guarded(() => { mode = 'rssi'; $('mode').value = mode; commit(makeDemoSession(), 'M1'); }));
$('new-field').addEventListener('click', guarded(() => {
  const next = makeDemoSession(); next.source = 'field'; next.observations = []; next.truth = null; next.target = { ssid: '', bssid: '02:00:00:00:00:01', channel: 6 };
  // Preserve a user-selected coordinate frame for easier field imports.
  next.origin = { ...session.origin }; next.bounds = { ...session.bounds };
  mode = 'rssi'; $('mode').value = mode; commit(next, null);
}));
$('save-session').addEventListener('click', guarded(() => {
  download('wifi-field-session.json', JSON.stringify({ ...session, savedAt: new Date().toISOString() }, null, 2), 'application/json');
}));
$('export-csv').addEventListener('click', guarded(() => download('wifi-observations.csv', exportObservationsCSV(session), 'text/csv')));
$('export-svg').addEventListener('click', guarded(() => {
  const clone = $('plot').cloneNode(true); clone.setAttribute('xmlns', ns);
  const metadata = svgNode('metadata', {}, JSON.stringify({ session, mode, approximateAreaM2: lastResult?.area ?? null, gridStepM: lastResult?.step ?? null }));
  clone.append(metadata);
  download('wifi-positioning-plot.svg', new XMLSerializer().serializeToString(clone), 'image/svg+xml');
}));
$('import-file').addEventListener('change', guarded(async event => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 1000000) throw new Error('Import a summarized session file smaller than 1 MB.');
  const text = await file.text();
  const next = file.name.toLowerCase().endsWith('.json') ? validateSession(JSON.parse(text)) : importObservationsCSV(text, session);
  mode = 'rssi'; $('mode').value = mode; commit(next, next.observations[0]?.id); event.target.value = '';
}));

render();
