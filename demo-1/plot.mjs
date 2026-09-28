import { distanceInterval } from '../demo-0/geometry.mjs';
const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#2459a6', '#a45c21', '#7d4aa3', '#137f80', '#a64064', '#526e29'];
let plotNumber = 0;
function node(name, attrs = {}, text) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}
export function drawSurveyPlot(svg, plane, network, result, evaluation, { showRings = true, source = 'field' } = {}) {
  svg.replaceChildren();
  const serial = ++plotNumber, clipId = `site-${serial}`, titleId = `title-${serial}`, descId = `desc-${serial}`;
  svg.setAttribute('viewBox', '0 0 900 670'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-labelledby', `${titleId} ${descId}`);
  svg.append(node('title', { id: titleId }, network ? `${network.ssid}: ${network.bssid} at ${network.frequencyMhz} MHz` : 'Survey station coordinates'));
  svg.append(node('desc', { id: descId }, network ? `${network.status}. ${network.usable.length} usable stations. ${result?.count ? `Approximately ${result.area.toFixed(1)} square metres of overlap.` : 'No location estimate.'}` : 'Add stations and import AP samples.'));
  svg.append(node('style', {}, 'text{font-family:Segoe UI,Arial,sans-serif;fill:#173044}.tick{font-size:12px;fill:#526b7d}'));
  const scale = Math.min(750 / plane.bounds.width, 510 / plane.bounds.height);
  const width = plane.bounds.width * scale, height = plane.bounds.height * scale;
  const x0 = 78 + (750 - width) / 2, y0 = 575;
  const X = x => x0 + x * scale, Y = y => y0 - y * scale;
  const defs = node('defs'), clip = node('clipPath', { id: clipId });
  clip.append(node('rect', { x: x0, y: y0 - height, width, height })); defs.append(clip); svg.append(defs);
  svg.append(node('rect', { x: x0, y: y0 - height, width, height, fill: '#f6faff', stroke: '#a7bfce', 'stroke-width': 1.4 }));
  const stepFor = max => { const raw = max / 6, base = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].find(n => n * base >= raw) * base; };
  for (let x = 0; x <= plane.bounds.width; x += stepFor(plane.bounds.width)) {
    svg.append(node('line', { x1: X(x), x2: X(x), y1: y0, y2: y0 - height, stroke: '#dbe6ef' }));
    svg.append(node('text', { x: X(x), y: y0 + 23, 'text-anchor': 'middle', class: 'tick' }, String(Math.round(x))));
  }
  for (let y = 0; y <= plane.bounds.height; y += stepFor(plane.bounds.height)) {
    svg.append(node('line', { x1: x0, x2: x0 + width, y1: Y(y), y2: Y(y), stroke: '#dbe6ef' }));
    svg.append(node('text', { x: x0 - 15, y: Y(y) + 4, 'text-anchor': 'end', class: 'tick' }, String(Math.round(y))));
  }
  svg.append(node('text', { x: x0 + width / 2, y: y0 + 51, 'text-anchor': 'middle', 'font-size': 13 }, 'East x (metres)'));
  svg.append(node('text', { x: x0 - 50, y: y0 - height / 2, transform: `rotate(-90 ${x0 - 50} ${y0 - height / 2})`, 'text-anchor': 'middle', 'font-size': 13 }, 'North y (metres)'));
  svg.append(node('text', { x: x0, y: y0 - height - 20, class: 'tick' }, 'Auto-arranged from station GPS · true north ↑'));
  const overlays = node('g', { 'clip-path': `url(#${clipId})` });
  if (network && showRings) for (const series of network.usable) {
    const station = series.station, index = plane.stations.findIndex(s => s.id === station.id), color = COLORS[index % COLORS.length];
    const interval = distanceInterval({ rssiDbm: series.summary.medianDbm, gpsAccuracyM: station.accuracyM }, network.model);
    const radiusCap = Math.hypot(plane.bounds.width, plane.bounds.height) * 2;
    if (!interval || interval.min > radiusCap) continue;
    const x = X(station.x), y = Y(station.y);
    const circle = r => r > 0 ? `M${x - r},${y}a${r},${r} 0 1 0 ${r * 2},0a${r},${r} 0 1 0 ${-r * 2},0Z` : '';
    overlays.append(node('path', { d: circle(Math.min(radiusCap, interval.max) * scale) + circle(interval.min * scale), fill: color, 'fill-opacity': .05, 'fill-rule': 'evenodd' }));
    for (const r of [interval.min, interval.max]) if (r <= radiusCap) overlays.append(node('circle', { cx: x, cy: y, r: r * scale, fill: 'none', stroke: color, 'stroke-opacity': .6, 'stroke-dasharray': '6 5', 'stroke-width': 1.4 }));
  }
  if (result?.runs.length) overlays.append(node('path', { d: result.runs.map(r => `M${X(r.x)},${Y(r.y + r.height)}h${r.width * scale}v${r.height * scale}h${-r.width * scale}Z`).join(''), fill: '#137f80', 'fill-opacity': .36 }));
  svg.append(overlays);
  plane.stations.forEach((station, i) => {
    const series = network?.stationSeries.find(s => s.station.id === station.id), heard = Boolean(series?.summary);
    const color = COLORS[i % COLORS.length], use = heard && series.quality.usable && station.enabled;
    const x = X(station.x), y = Y(station.y), group = node('g', { opacity: station.enabled ? 1 : .4 });
    group.append(node('circle', { cx: x, cy: y, r: station.accuracyM * scale, fill: color, 'fill-opacity': .06, stroke: color, 'stroke-opacity': .25 }));
    group.append(node('rect', { x: x - 5, y: y - 5, width: 10, height: 10, fill: heard ? color : '#fff', stroke: heard ? '#fff' : '#7b90a0', 'stroke-width': 1.5 }));
    const right = station.x > plane.bounds.width * .65, tx = x + (right ? -12 : 12), anchor = right ? 'end' : 'start';
    group.append(node('text', { x: tx, y: y - 7, 'text-anchor': anchor, 'font-size': 14, 'font-weight': 650 }, station.id));
    group.append(node('text', { x: tx, y: y + 11, 'text-anchor': anchor, class: 'tick' }, heard ? `${series.summary.medianDbm.toFixed(1)} dBm${use ? '' : ' · review'}` : 'not observed'));
    svg.append(group);
  });
  if (evaluation?.point && evaluation.inPlot) {
    const x = X(evaluation.point.x), y = Y(evaluation.point.y);
    svg.append(node('circle', { cx: x, cy: y, r: evaluation.accuracyM * scale, fill: 'none', stroke: '#173044', 'stroke-opacity': .3, 'stroke-dasharray': '2 3' }));
    svg.append(node('rect', { x: x - 7, y: y - 7, width: 14, height: 14, rx: 2, fill: '#173044', stroke: '#fff', 'stroke-width': 2 }));
    svg.append(node('text', { x: x + 13, y: y - 8, 'font-size': 13, 'font-weight': 650 }, 'Known AP'));
  }
  if (result?.best) {
    const x = X(result.best.x), y = Y(result.best.y);
    svg.append(node('path', { d: `M${x},${y - 7}l7,7l-7,7l-7,-7Z`, fill: '#fff', stroke: '#173044', 'stroke-width': 2 }));
  }
  if (network && !result) svg.append(node('text', { x: x0 + width / 2, y: y0 - height / 2, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 650 }, network.status));
  const origin = plane.origin ? `${plane.origin.latitude.toFixed(6)}, ${plane.origin.longitude.toFixed(6)}` : 'not set';
  svg.append(node('text', { x: x0, y: 640, class: 'tick' }, `${source === 'synthetic' ? 'Simulated' : 'Field'} metadata · origin ${origin}`));
  svg.append(node('text', { x: x0, y: 661, class: 'tick' }, network ? `${network.bssid} · ${network.frequencyMhz} MHz · ${network.model.calibrated ? 'calibration recorded' : 'exploratory model'}` : 'No radio acquisition connected'));
}
