#!/usr/bin/env node
// Drive the Vite preview server with Puppeteer to render HUD frames,
// then composite with FFmpeg into transparent WebM (or keep PNG sequence).
//
// Usage:
//   node scripts/export-frames.mjs \
//     --telemetry /samples/telemetry.csv \
//     --track /samples/track.gpx \
//     --duration 120 --fps 60 \
//     --width 1920 --height 1080 \
//     --coord wgs84 \
//     --out out/hud.webm
//
// Prereqs:
//   1) npm run build && npm run preview (or point --base to any running host)
//   2) ffmpeg in PATH (only if writing .webm/.mp4)

import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const BASE = arg('base', 'http://localhost:4173');
const TELEMETRY = arg('telemetry', '/samples/telemetry.csv');
const TRACK = arg('track', '/samples/track.gpx');
const DURATION = Number(arg('duration', '10'));
const FPS = Number(arg('fps', '60'));
const WIDTH = Number(arg('width', '1920'));
const HEIGHT = Number(arg('height', '1080'));
const UNIT = arg('unit', 'kmh');
const PLAYER = arg('player', 'ANNA');
const COORD = arg('coord', 'wgs84');
const OUT = arg('out', 'out/hud.webm');

const framesDir = resolve(ROOT, 'out', 'frames');
if (existsSync(framesDir)) rmSync(framesDir, { recursive: true });
mkdirSync(framesDir, { recursive: true });

const puppeteer = await import('puppeteer').then(m => m.default);

const url = new URL(BASE);
url.searchParams.set('telemetry', TELEMETRY);
url.searchParams.set('track', TRACK);
url.searchParams.set('exporter', '1');
url.searchParams.set('unit', UNIT);
url.searchParams.set('player', PLAYER);
url.searchParams.set('coord', COORD);

console.log(`[export] opening ${url}`);
const browser = await puppeteer.launch({
  headless: 'new',
  defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(url.toString(), { waitUntil: 'networkidle0' });

// Wait for data load & exporter hooks
await page.waitForFunction(
  () => typeof window.seekTo === 'function' && typeof window.readyForFrame === 'function',
  { timeout: 10000 },
);
// Wait until telemetry is populated
await page.waitForFunction(
  () => {
    const s = window.__hudState?.();
    return s?.telemetry && s.telemetry.samples?.length > 0;
  },
  { timeout: 10000 },
).catch(() => {
  // Fall back: just give the page a moment.
  return new Promise(r => setTimeout(r, 1500));
});

const totalFrames = Math.ceil(DURATION * FPS);
const pad = String(totalFrames).length;

console.log(`[export] rendering ${totalFrames} frames at ${FPS}fps (${WIDTH}x${HEIGHT})`);
for (let i = 0; i < totalFrames; i++) {
  const t = i / FPS;
  await page.evaluate(async time => {
    window.seekTo(time);
    await window.readyForFrame();
  }, t);
  const file = resolve(framesDir, `frame_${String(i).padStart(pad, '0')}.png`);
  await page.screenshot({ path: file, omitBackground: true, type: 'png' });
  if (i % FPS === 0) process.stdout.write(`\r[export] frame ${i}/${totalFrames}`);
}
process.stdout.write('\n');

await browser.close();

// Compose if output is video
const outPath = resolve(ROOT, OUT);
mkdirSync(dirname(outPath), { recursive: true });
const ext = extname(outPath).toLowerCase();

if (ext === '.webm') {
  const pattern = resolve(framesDir, `frame_%0${pad}d.png`);
  await run('ffmpeg', [
    '-y',
    '-framerate', String(FPS),
    '-i', pattern,
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p',
    '-b:v', '0',
    '-crf', '28',
    outPath,
  ]);
  console.log(`[export] wrote ${outPath}`);
} else if (ext === '.mov' || ext === '.mp4') {
  const pattern = resolve(framesDir, `frame_%0${pad}d.png`);
  await run('ffmpeg', [
    '-y',
    '-framerate', String(FPS),
    '-i', pattern,
    '-c:v', 'prores_ks',
    '-profile:v', '4',
    '-pix_fmt', 'yuva444p10le',
    outPath,
  ]);
  console.log(`[export] wrote ${outPath}`);
} else {
  console.log(`[export] frames kept at ${framesDir} (no video muxing for extension ${ext})`);
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('exit', c => (c === 0 ? res(null) : rej(new Error(`${cmd} exited ${c}`))));
  });
}
