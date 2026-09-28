import { toGPS, fitCalibration } from '../demo-0/geometry.mjs';
import { emptySurvey, validateSurvey, makeSurveyExample, importStationsCSV, importSamplesCSV, arrangeStations, listNetworks, estimateNetwork, evaluateReference, stationsCSV, samplesCSV, exportCSV } from './survey.mjs';
import { drawSurveyPlot } from './plot.mjs';
const $ = id => document.getElementById(id);
let survey = makeSurveyExample(), selectedKey = '', editedStationId = null, networks = [], plane = null, result = null, evaluation = null;
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function message(text) { $('message').textContent = text; $('message').hidden = !text; }
function guarded(action) { return async event => { event.preventDefault(); try { await action(event); message(''); } catch (error) { message(error.message); } finally { if (event.target.type === 'file') event.target.value = ''; } }; }
function num(id) { if (!$(id).value.trim() || !Number.isFinite(Number($(id).value))) throw new Error(`Enter a numeric value for ${id}.`); return Number($(id).value); }
function value(id, val) { $(id).value = val ?? ''; }
function selectedNetwork() { return networks.find(n => n.key === selectedKey); }
function commit(next, { stationId, resetSelection = false } = {}) {
  validateSurvey(next); survey = next;
  if (resetSelection) { selectedKey = ''; editedStationId = null; }
  if (stationId !== undefined) editedStationId = stationId;
  render();
}
function download(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })), link = el('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function newStationEditor() {
  editedStationId = null; $('station-form').reset(); $('station-id').readOnly = false; $('delete-station').disabled = true;
  let index = 1; while (survey.stations.some(s => s.id === `P${index}`)) index++;
  value('station-id', `P${index}`); value('station-accuracy', 5); $('station-editor-title').textContent = 'Add a station';
}
function editStation(id) {
  const station = survey.stations.find(s => s.id === id); editedStationId = id;
  $('station-id').readOnly = true; $('delete-station').disabled = false; $('station-editor-title').textContent = `Edit ${id}`;
  for (const [key, val] of Object.entries({ 'station-id': id, 'station-lat': station.latitude, 'station-lon': station.longitude, 'station-accuracy': station.accuracyM, 'station-notes': station.notes })) value(key, val);
}
function renderStations() {
  $('station-list').replaceChildren();
  survey.stations.forEach((station, i) => {
    const row = el('div', undefined, 'station-row'), label = el('label'), checkbox = el('input'); row.style.setProperty('--station', ['#2459a6', '#a45c21', '#7d4aa3', '#137f80'][i % 4]);
    checkbox.type = 'checkbox'; checkbox.checked = station.enabled; checkbox.setAttribute('aria-label', `Use station ${station.id}`);
    checkbox.addEventListener('change', () => { station.enabled = checkbox.checked; renderNetworks(); }); label.append(checkbox);
    const button = el('button'); button.type = 'button'; button.setAttribute('aria-label', `Edit station ${station.id}`);
    button.append(el('strong', station.id), el('span', `±${station.accuracyM} m`, 'power'), el('small', `${station.latitude.toFixed(6)}, ${station.longitude.toFixed(6)}`));
    button.addEventListener('click', () => editStation(station.id)); row.append(label, button); $('station-list').append(row);
  });
  const current = $('capture-station').value; $('capture-station').replaceChildren(new Option('Use station_id from file', ''));
  survey.stations.forEach(s => $('capture-station').append(new Option(s.id, s.id)));
  if (survey.stations.some(s => s.id === current)) $('capture-station').value = current;
}
function renderCaptures() {
  const captures = new Map();
  for (const sample of survey.samples) {
    if (!captures.has(sample.captureId)) captures.set(sample.captureId, { stationId: sample.stationId, count: 0 });
    captures.get(sample.captureId).count++;
  }
  $('capture-list').replaceChildren();
  if (!captures.size) $('capture-list').append(el('p', 'No capture files imported.', 'small'));
  for (const [id, capture] of captures) {
    const row = el('div', undefined, 'capture-row'), name = el('span', id); name.append(el('small', `${capture.stationId} · ${capture.count} samples`));
    const remove = el('button', 'Remove'); remove.setAttribute('aria-label', `Remove capture ${id}`);
    remove.addEventListener('click', () => { const next = structuredClone(survey); next.samples = next.samples.filter(s => s.captureId !== id); commit(next); });
    row.append(name, remove); $('capture-list').append(row);
  }
}
function renderCoverage() {
  const head = $('coverage-table').querySelector('thead'), body = $('coverage-table').querySelector('tbody'); head.replaceChildren(); body.replaceChildren();
  const header = el('tr'); header.append(el('th', 'Access point')); survey.stations.forEach(s => header.append(el('th', s.id))); header.append(el('th', 'Assessment')); head.append(header);
  for (const network of networks) {
    const row = el('tr'); row.classList.toggle('selected', network.key === selectedKey); row.dataset.key = network.key;
    const identity = el('td'), button = el('button', network.ssid); button.setAttribute('aria-label', `Select AP ${network.bssid} at ${network.frequencyMhz} MHz`);
    button.addEventListener('click', () => { selectedKey = network.key; renderCoverage(); renderSelected(); });
    identity.append(button, el('small', network.bssid), el('small', `${network.frequencyMhz} MHz${network.ssids.length > 1 ? ' · multiple SSID names observed' : ''}`)); row.append(identity);
    for (const series of network.stationSeries) {
      const cell = el('td');
      if (!series.summary) cell.textContent = '—';
      else { cell.className = series.quality.usable && series.station.enabled ? 'cell-good' : 'cell-review'; cell.append(el('span', `${series.summary.medianDbm.toFixed(1)}`), el('small', `${series.summary.sampleCount} samples${series.station.enabled ? '' : ' · excluded'}`)); cell.title = series.quality.issues.join(' '); }
      row.append(cell);
    }
    const status = el('td'); status.append(el('span', network.status, 'status-label'), el('small', `${network.usable.length} usable / ${network.detectedStations} observed`)); row.append(status); body.append(row);
  }
  $('empty-networks').hidden = networks.length > 0;
  $('survey-counts').textContent = `${survey.stations.length} stations · ${networks.length} AP groups · ${survey.samples.length} samples`;
}
function renderSelected() {
  const network = selectedNetwork();
  result = network ? estimateNetwork(network, plane) : null;
  evaluation = network ? evaluateReference(survey.references[network.key], plane, result) : null;
  drawSurveyPlot($('plot'), plane, network, result, evaluation, { showRings: $('show-rings').checked, source: survey.source });
  $('ap-title').textContent = network?.ssid || 'Survey station layout';
  $('ap-subtitle').textContent = network ? `${network.bssid} · ${network.frequencyMhz} MHz · ${network.status}` : 'Import station GPS and AP metadata to begin.';
  $('station-result').textContent = network ? `${network.usable.length} / ${network.detectedStations}` : '—';
  $('sample-result').textContent = network ? `${network.totalSamples} received samples · ${survey.stations.length} total stations` : '';
  $('area-result').textContent = result ? `≈ ${Math.round(result.area).toLocaleString()} m²` : 'Not estimable';
  const gps = result?.best ? toGPS(result.best.x, result.best.y, plane.origin) : null;
  $('fit-result').textContent = gps ? `Nominal fit ${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}` : '';
  $('error-result').textContent = evaluation?.errorM !== null && evaluation?.errorM !== undefined ? `${evaluation.errorM.toFixed(1)} m` : survey.references[network?.key] ? 'Unavailable' : 'No reference';
  $('reference-result').textContent = evaluation ? `AP GPS ±${evaluation.accuracyM} m · ${evaluation.inside ? 'inside' : 'outside'} constraints${evaluation.inPlot ? '' : ' · outside plot'}` : '';
  const diagnostics = [];
  if (!network) diagnostics.push('Add stations and import their radio captures.');
  else if (!network.canEstimate) diagnostics.push(`${network.status}. ${network.geometry.reason}`);
  else {
    if (!result.count) diagnostics.push('No sampled overlap. Review calibration, readings, tolerances and plot extent.');
    if (result.touchesBoundary) diagnostics.push('Overlap reaches the boundary; increase the plot margin to inspect its full extent.');
    if (survey.source === 'field' && !network.model.calibrated) diagnostics.push('Unknown AP calibration: this is an exploratory model result.');
    if (!diagnostics.length) diagnostics.push('A compatible overlap exists. Evaluate against the independent reference and repeat the experiment.');
  }
  if (survey.source === 'synthetic') diagnostics.unshift('Simulated observations.');
  $('diagnostic').textContent = diagnostics.join(' '); $('diagnostic').classList.toggle('warning', !network?.canEstimate || !result?.count || result?.touchesBoundary || (survey.source === 'field' && !network.model.calibrated));
  const body = $('series-table').querySelector('tbody'); body.replaceChildren();
  for (const series of network?.stationSeries || []) {
    const s = series.summary, row = el('tr');
    const status = !series.station.enabled ? 'Station excluded' : series.quality.usable ? 'Usable for exploratory estimation' : series.quality.issues.join(' ');
    [series.station.id, s ? `${s.medianDbm.toFixed(1)} dBm` : '—', s?.sampleCount ?? '—', s ? `${s.spanSeconds.toFixed(1)} s` : '—', s?.timeBins ?? '—', s ? `${s.spreadDb.toFixed(1)} dB` : '—', status].forEach(v => row.append(el('td', String(v)))); body.append(row);
  }
  for (const form of ['model-form', 'reference-form']) for (const element of $(form).elements) element.disabled = !network;
  $('fit-calibration').disabled = !network;
  value('model-reference', network?.model.referenceDbm); value('model-exponent', network?.model.exponent); value('model-tolerance', network?.model.toleranceDb); $('model-calibrated').checked = Boolean(network?.model.calibrated);
  const reference = survey.references[network?.key]; value('ap-lat', reference?.latitude); value('ap-lon', reference?.longitude); value('ap-accuracy', reference?.accuracyM ?? 5);
  $('calibration-report').textContent = ''; $('calibration-data').value = '';
  $('gallery-section').hidden = true;
}
function renderNetworks() {
  plane = arrangeStations(survey.stations, survey.paddingM); networks = listNetworks(survey);
  if (!networks.some(n => n.key === selectedKey)) selectedKey = networks[0]?.key || '';
  renderCoverage(); renderSelected();
}
function render() {
  $('source-badge').textContent = survey.source === 'synthetic' ? 'Simulated survey' : 'Field metadata · no live receiver'; $('source-badge').classList.toggle('field', survey.source === 'field');
  const l = survey.limits;
  for (const [id, val] of Object.entries({ 'min-samples': l.minSamples, 'min-span': l.minSpanSeconds, 'min-bins': l.minTimeBins, 'bin-seconds': l.binSeconds, 'max-mad': l.maxMadDb, 'plot-margin': survey.paddingM })) value(id, val);
  renderStations(); renderCaptures(); renderNetworks();
  if (editedStationId && survey.stations.some(s => s.id === editedStationId)) editStation(editedStationId); else newStationEditor();
}

$('add-station').addEventListener('click', newStationEditor);
$('station-form').addEventListener('submit', guarded(() => {
  const next = structuredClone(survey), id = $('station-id').value.trim();
  if (!editedStationId && next.stations.some(s => s.id === id)) throw new Error(`Station ${id} already exists. Select it to edit.`);
  const station = { id, latitude: num('station-lat'), longitude: num('station-lon'), accuracyM: num('station-accuracy'), notes: $('station-notes').value, enabled: next.stations.find(s => s.id === id)?.enabled ?? true };
  if (editedStationId) next.stations[next.stations.findIndex(s => s.id === editedStationId)] = station; else next.stations.push(station);
  commit(next, { stationId: id });
}));
$('delete-station').addEventListener('click', guarded(() => {
  if (survey.samples.some(s => s.stationId === editedStationId)) throw new Error('Remove this station’s captures before removing its GPS record.');
  const next = structuredClone(survey); next.stations = next.stations.filter(s => s.id !== editedStationId); commit(next);
}));
async function readFile(event) { const file = event.target.files[0]; if (!file) return null; if (file.size > 16000000) throw new Error('Use files smaller than 16 MB.'); return { text: await file.text(), name: file.name }; }
$('gps-file').addEventListener('change', guarded(async event => { const file = await readFile(event); if (!file) return; if (survey.source === 'synthetic') throw new Error('Start a new field survey before importing field GPS.'); commit(importStationsCSV(file.text, survey)); event.target.value = ''; }));
$('samples-file').addEventListener('change', guarded(async event => { const file = await readFile(event); if (!file) return; commit(importSamplesCSV(file.text, survey, { stationId: $('capture-station').value, captureId: file.name.replace(/\.csv$/i, '') })); event.target.value = ''; }));
$('survey-file').addEventListener('change', guarded(async event => { const file = await readFile(event); if (!file) return; commit(JSON.parse(file.text), { resetSelection: true }); }));
$('model-form').addEventListener('submit', guarded(() => {
  const next = structuredClone(survey); next.models[selectedKey] = { referenceDbm: num('model-reference'), exponent: num('model-exponent'), toleranceDb: num('model-tolerance'), calibrated: $('model-calibrated').checked }; commit(next);
}));
$('fit-calibration').addEventListener('click', guarded(() => {
  const rows = $('calibration-data').value.trim().replaceAll('−', '-').split('\n').filter(line => line.trim()).map(line => { const values = line.trim().split(/[\s,;]+/); if (values.length !== 2) throw new Error('Use one distance, RSSI pair per line.'); return { distanceM: Number(values[0]), rssiDbm: Number(values[1]) }; });
  const fit = fitCalibration(rows), next = structuredClone(survey), network = selectedNetwork();
  next.models[selectedKey] = { ...network.model, referenceDbm: Number(fit.referenceDbm.toFixed(4)), exponent: Number(fit.exponent.toFixed(4)), calibrated: false }; commit(next);
  $('calibration-report').textContent = `Fit RMS ${fit.rmsDb.toFixed(2)} dB. Validate separately and choose the residual tolerance before marking calibrated.`;
}));
$('reference-form').addEventListener('submit', guarded(() => {
  const next = structuredClone(survey); next.references[selectedKey] = { latitude: num('ap-lat'), longitude: num('ap-lon'), accuracyM: num('ap-accuracy') }; commit(next);
}));
$('remove-reference').addEventListener('click', guarded(() => { const next = structuredClone(survey); delete next.references[selectedKey]; commit(next); }));
$('criteria-form').addEventListener('submit', guarded(() => {
  const next = structuredClone(survey); next.limits = { minSamples: num('min-samples'), minSpanSeconds: num('min-span'), minTimeBins: num('min-bins'), binSeconds: num('bin-seconds'), maxMadDb: num('max-mad') }; next.paddingM = num('plot-margin'); commit(next);
}));
$('show-rings').addEventListener('change', () => drawSurveyPlot($('plot'), plane, selectedNetwork(), result, evaluation, { showRings: $('show-rings').checked, source: survey.source }));
$('new-survey').addEventListener('click', guarded(() => commit(emptySurvey(), { resetSelection: true })));
$('load-example').addEventListener('click', guarded(() => commit(makeSurveyExample(), { resetSelection: true })));
$('save-survey').addEventListener('click', guarded(() => download('wifi-survey-demo-1.json', JSON.stringify({ ...survey, savedAt: new Date().toISOString() }, null, 2), 'application/json')));
$('export-gps').addEventListener('click', guarded(() => download('stations.csv', stationsCSV(survey), 'text/csv')));
$('export-samples').addEventListener('click', guarded(() => download('ap-rssi-samples.csv', samplesCSV(survey), 'text/csv')));
$('export-results').addEventListener('click', guarded(() => {
  const rows = networks.map(network => { const result = estimateNetwork(network, plane), evaluation = evaluateReference(survey.references[network.key], plane, result), gps = result?.best ? toGPS(result.best.x, result.best.y, plane.origin) : null;
    return { bssid: network.bssid, ssid: network.ssid, frequency_mhz: network.frequencyMhz, source: survey.source, status: result && !result.count ? 'No overlap' : result?.touchesBoundary ? 'Region clipped' : network.status,
      observed_stations: network.detectedStations, usable_stations: network.usable.length, total_samples: network.totalSamples, model_calibrated: network.model.calibrated,
      area_m2: result?.area ?? '', boundary_clipped: result?.touchesBoundary ?? '', estimated_latitude: gps?.latitude ?? '', estimated_longitude: gps?.longitude ?? '', reference_inside: evaluation?.inside ?? '', reference_error_m: evaluation?.errorM ?? '', reference_accuracy_m: evaluation?.accuracyM ?? '' }; });
  download('ap-positioning-results.csv', exportCSV(rows, Object.keys(rows[0] || { bssid: '' })), 'text/csv');
}));
$('export-plot').addEventListener('click', guarded(() => {
  if (!selectedNetwork()) throw new Error('Select an AP first.');
  const clone = $('plot').cloneNode(true); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const metadata = document.createElementNS('http://www.w3.org/2000/svg', 'metadata'); metadata.textContent = JSON.stringify({ source: survey.source, key: selectedKey, model: selectedNetwork().model, limits: survey.limits, origin: plane.origin, approximateAreaM2: result?.area ?? null, stepM: result?.step ?? null, reference: survey.references[selectedKey] || null }); clone.append(metadata);
  download(`ap-${selectedKey.replaceAll(':', '-')}.svg`, new XMLSerializer().serializeToString(clone), 'image/svg+xml');
}));
$('show-gallery').addEventListener('click', guarded(() => {
  $('gallery').replaceChildren(); $('gallery-section').hidden = false;
  for (const network of networks.filter(n => n.canEstimate)) {
    const r = estimateNetwork(network, plane), e = evaluateReference(survey.references[network.key], plane, r), card = el('article', undefined, 'gallery-card');
    card.append(el('h3', network.ssid), el('p', `${network.bssid} · ${network.frequencyMhz} MHz · ${network.status}`));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); drawSurveyPlot(svg, plane, network, r, e, { showRings: true, source: survey.source }); card.append(svg);
    card.append(el('p', r.count ? `≈ ${Math.round(r.area)} m²${r.touchesBoundary ? ' · clipped by plot' : ''}` : 'No sampled overlap'));
    const button = el('button', 'Inspect AP', 'subtle'); button.addEventListener('click', () => { selectedKey = network.key; renderCoverage(); renderSelected(); $('plot').scrollIntoView({ block: 'center' }); }); card.append(button); $('gallery').append(card);
  }
  if (!$('gallery').children.length) $('gallery').append(el('p', 'No AP has enough usable station geometry yet.', 'small'));
}));
render();
