#!/usr/bin/env node
// Convert lon,lat,alt CSV to GPX at fixed 50Hz sample rate.
// Usage: node scripts/csv-to-gpx-50hz.mjs <input.csv> [output.gpx] [startISO]
import fs from 'node:fs';
import path from 'node:path';

const [, , inPath, outPathArg, startArg] = process.argv;
if (!inPath) {
  console.error('usage: csv-to-gpx-50hz.mjs <input.csv> [output.gpx] [startISO]');
  process.exit(1);
}

const base = path.basename(inPath, path.extname(inPath));
const outPath = outPathArg || path.join(path.dirname(inPath), `${base}.gpx`);

// Try to parse start time from filename pattern *_YYYYMMDD_HHMMSS, treat as Asia/Shanghai (UTC+8).
let startMs;
if (startArg) {
  startMs = Date.parse(startArg);
} else {
  const m = base.match(/(\d{8})_(\d{6})/);
  if (m) {
    const [, d, t] = m;
    const iso = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}+08:00`;
    startMs = Date.parse(iso);
  } else {
    startMs = Date.now();
  }
}

const raw = fs.readFileSync(inPath, 'utf8').trim().split(/\r?\n/);
const header = raw[0].split(',').map(s => s.trim().toLowerCase());
const iLon = header.indexOf('lon');
const iLat = header.indexOf('lat');
const iAlt = header.indexOf('alt');
if (iLon < 0 || iLat < 0) throw new Error('CSV must have lon,lat columns');

const dtMs = 1000 / 50; // 50 Hz

const out = [];
out.push('<?xml version="1.0" encoding="UTF-8"?>');
out.push('<gpx version="1.1" creator="hud5" xmlns="http://www.topografix.com/GPX/1/1">');
out.push(`  <trk><name>${base}</name><trkseg>`);

for (let i = 1; i < raw.length; i++) {
  const cols = raw[i].split(',');
  if (cols.length < 2) continue;
  const lon = Number(cols[iLon]);
  const lat = Number(cols[iLat]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
  const ele = iAlt >= 0 ? Number(cols[iAlt]) : NaN;
  const t = new Date(startMs + (i - 1) * dtMs).toISOString();
  const eleTag = Number.isFinite(ele) ? `<ele>${ele}</ele>` : '';
  out.push(`      <trkpt lat="${lat}" lon="${lon}">${eleTag}<time>${t}</time></trkpt>`);
}

out.push('  </trkseg></trk>');
out.push('</gpx>');

fs.writeFileSync(outPath, out.join('\n'));
console.log(`wrote ${outPath} (${raw.length - 1} samples @ 50Hz, ${(raw.length - 1) / 50}s)`);
