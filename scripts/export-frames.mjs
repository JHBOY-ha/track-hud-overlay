#!/usr/bin/env node
// Drive the Vite preview server with Puppeteer to render HUD frames,
// then composite with FFmpeg into transparent WebM (or keep PNG sequence).
//
// Usage:
//   node scripts/export-frames.mjs \
//     --telemetry /samples/telemetry.csv \
//     --track /samples/track.gpx \
//     --duration 120 --range-start 0 --range-end 120 --fps 60 \
//     --progress-start 0 --progress-end 120 \
//     --width 1920 --height 1080 \
//     --coord wgs84 \
//     --out out/hud.webm
//
// Prereqs:
//   1) npm run build && npm run preview (or point --base to any running host)
//   2) ffmpeg in PATH (only if writing .webm/.mp4)

import { createReadStream, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { basename, resolve, dirname, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEFAULT_BASE = 'http://127.0.0.1:4173';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

export function normalizeMediaArg(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function localFileUrlFor(filePath, port, index = 0) {
  if (!isAbsolute(filePath) || !existsSync(filePath)) return filePath;
  return `http://127.0.0.1:${port}/file/${index}/${encodeURIComponent(basename(filePath))}`;
}

export function secondsToFrameArg(seconds, fps) {
  return Math.round(Number(seconds) * Number(fps));
}

export function frameArgsToSeconds(durationFrames, rangeStartFrame, rangeEndFrame, fps) {
  const rate = Number(fps);
  return {
    durationSeconds: Number(durationFrames) / rate,
    rangeStartSeconds: Number(rangeStartFrame) / rate,
    rangeEndSeconds: Number(rangeEndFrame) / rate,
  };
}

export function frameNumberToTimecode(frameNumber, fps) {
  const rate = Number(fps);
  const sign = Number(frameNumber) < 0 ? '-' : '';
  const total = Math.abs(Math.round(Number(frameNumber)));
  const hh = Math.floor(total / (rate * 3600));
  const afterHours = total % (rate * 3600);
  const mm = Math.floor(afterHours / (rate * 60));
  const afterMinutes = afterHours % (rate * 60);
  const ss = Math.floor(afterMinutes / rate);
  const ff = afterMinutes % rate;
  const pad2 = n => String(n).padStart(2, '0');
  const frameDigits = String(rate - 1).length;
  return `${sign}${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${String(ff).padStart(frameDigits, '0')}`;
}

function isLocalFileArg(value) {
  return isAbsolute(value) && existsSync(value) && statSync(value).isFile();
}

async function startLocalFileServer(files) {
  if (files.length === 0) return null;
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const m = url.pathname.match(/^\/file\/(\d+)\//);
      if (!m) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const file = files[Number(m[1])];
      if (!file) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', contentTypeFor(file));
      createReadStream(file).pipe(res);
    } catch (error) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  console.log(`[export] serving local input files on http://127.0.0.1:${port}`);
  return {
    port,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function waitForHttp(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      await res.arrayBuffer().catch(() => {});
      return true;
    } catch (error) {
      lastError = error;
      await new Promise(r => setTimeout(r, 250));
    }
  }
  if (lastError) throw lastError;
  return false;
}

async function ensurePreviewServer(base) {
  try {
    await waitForHttp(base, 1000);
    return null;
  } catch {
    if (base !== DEFAULT_BASE) {
      throw new Error(`Cannot reach ${base}. Start the app server or pass a reachable --base URL.`);
    }
  }

  console.log('[export] preview server not reachable; starting npm run preview on 127.0.0.1:4173');
  const child = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  await waitForHttp(base, 15000).catch(error => {
    child.kill();
    throw new Error(
      `Could not start preview server at ${base}. Run npm run build first, then retry. ${error}`,
    );
  });
  return child;
}

export async function main() {
  const BASE = arg('base', DEFAULT_BASE);
  const RAW_TELEMETRY = normalizeMediaArg(arg('telemetry', '/samples/telemetry.csv'));
  const RAW_TRACK = normalizeMediaArg(arg('track', '/samples/track.gpx'));
  const FPS = Number(arg('fps', '60'));
  const DURATION_FRAMES = Number(arg('duration', String(10 * FPS)));
  const RANGE_START_FRAME = Number(arg('range-start', 'NaN'));
  const RANGE_END_FRAME = Number(arg('range-end', 'NaN'));
  const WIDTH = Number(arg('width', '1920'));
  const HEIGHT = Number(arg('height', '1080'));
  const UNIT = arg('unit', 'kmh');
  const PLAYER = arg('player', 'ANNA');
  const COORD = arg('coord', 'wgs84');
  const TELEMETRY_OFFSET = Number(arg('telemetry-offset', '0'));
  const TRACK_OFFSET = Number(arg('track-offset', '0'));
  const VIDEO_OFFSET = Number(arg('video-offset', '0'));
  const PROGRESS_START = Number(arg('progress-start', 'NaN'));
  const PROGRESS_END = Number(arg('progress-end', 'NaN'));
  const SNAP_TO_ROADS = arg('snap-to-roads', null);
  const SNAP_MAX_DIST = arg('snap-max-dist', null);
  const MINIMAP_RADIUS = arg('minimap-radius', null);
  const MINIMAP_TILT = arg('minimap-tilt', null);
  const MINIMAP_STROKE = arg('minimap-stroke', null);
  const OUT = arg('out', 'out/hud.webm');

  const localFiles = [RAW_TELEMETRY, RAW_TRACK].filter(isLocalFileArg);
  const missingLocal = [RAW_TELEMETRY, RAW_TRACK].filter(v => isAbsolute(v) && !isLocalFileArg(v));
  if (missingLocal.length) {
    throw new Error(`Local input file not found: ${missingLocal.join(', ')}`);
  }

  const localServer = await startLocalFileServer(localFiles);
  const localPort = localServer?.port ?? 0;
  const mapMedia = value => {
    const index = localFiles.indexOf(value);
    return index >= 0 ? localFileUrlFor(value, localPort, index) : value;
  };
  const TELEMETRY = mapMedia(RAW_TELEMETRY);
  const TRACK = mapMedia(RAW_TRACK);
  const {
    durationSeconds: DURATION,
    rangeStartSeconds: RANGE_START,
    rangeEndSeconds: RANGE_END,
  } = frameArgsToSeconds(DURATION_FRAMES, RANGE_START_FRAME, RANGE_END_FRAME, FPS);
  const outputTimecode = Number.isFinite(RANGE_START_FRAME)
    ? frameNumberToTimecode(RANGE_START_FRAME, FPS)
    : '00:00:00:00';

  const previewProcess = await ensurePreviewServer(BASE);
  try {
    const outPath = resolve(ROOT, OUT);
    mkdirSync(dirname(outPath), { recursive: true });
    const ext = extname(outPath).toLowerCase();
    const pipeToFfmpeg = ext === '.webm' || ext === '.mov' || ext === '.mp4';

    let framesDir = null;
    if (!pipeToFfmpeg) {
      framesDir = resolve(ROOT, 'out', 'frames');
      if (existsSync(framesDir)) rmSync(framesDir, { recursive: true });
      mkdirSync(framesDir, { recursive: true });
    }

    const puppeteer = await import('puppeteer').then(m => m.default);

    const url = new URL(BASE);
    url.searchParams.set('telemetry', TELEMETRY);
    url.searchParams.set('track', TRACK);
    url.searchParams.set('exporter', '1');
    url.searchParams.set('unit', UNIT);
    url.searchParams.set('player', PLAYER);
    url.searchParams.set('coord', COORD);
    if (Number.isFinite(TELEMETRY_OFFSET)) {
      url.searchParams.set('telemetryOffset', String(TELEMETRY_OFFSET));
    }
    if (Number.isFinite(TRACK_OFFSET)) {
      url.searchParams.set('trackOffset', String(TRACK_OFFSET));
    }
    if (Number.isFinite(VIDEO_OFFSET)) {
      url.searchParams.set('videoOffset', String(VIDEO_OFFSET));
    }
    if (Number.isFinite(RANGE_START) && Number.isFinite(RANGE_END)) {
      url.searchParams.set('rangeStart', String(RANGE_START));
      url.searchParams.set('rangeEnd', String(RANGE_END));
      url.searchParams.set('t', String(RANGE_START));
    }
    if (Number.isFinite(PROGRESS_START) && Number.isFinite(PROGRESS_END) && PROGRESS_END > PROGRESS_START) {
      url.searchParams.set('progressStart', String(PROGRESS_START));
      url.searchParams.set('progressEnd', String(PROGRESS_END));
    }
    if (SNAP_TO_ROADS !== null) {
      const v = String(SNAP_TO_ROADS).trim().toLowerCase();
      url.searchParams.set('snapToRoads', v === '1' || v === 'true' ? '1' : '0');
    }
    if (SNAP_MAX_DIST !== null && Number.isFinite(Number(SNAP_MAX_DIST))) {
      url.searchParams.set('snapMaxDistM', String(Number(SNAP_MAX_DIST)));
    }
    if (MINIMAP_RADIUS !== null && Number.isFinite(Number(MINIMAP_RADIUS))) {
      url.searchParams.set('minimapViewRadiusM', String(Number(MINIMAP_RADIUS)));
    }
    if (MINIMAP_TILT !== null && Number.isFinite(Number(MINIMAP_TILT))) {
      url.searchParams.set('minimapTiltDeg', String(Number(MINIMAP_TILT)));
    }
    if (MINIMAP_STROKE !== null && Number.isFinite(Number(MINIMAP_STROKE))) {
      url.searchParams.set('minimapStrokeWidth', String(Number(MINIMAP_STROKE)));
    }

    console.log(`[export] opening ${url}`);
    const browser = await puppeteer.launch({
      headless: 'new',
      defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
    });
    const page = await browser.newPage();
    await page.goto(url.toString(), { waitUntil: 'networkidle0' });

    await page.waitForFunction(
      () => typeof window.seekTo === 'function' && typeof window.readyForFrame === 'function',
      { timeout: 10000 },
    );
    await page.waitForFunction(
      hasTrack => {
        const s = window.__hudState?.();
        const telemetryReady = s?.telemetry && s.telemetry.samples?.length > 0;
        const trackReady = !hasTrack || (s?.track && s.track.points?.length > 0);
        return telemetryReady && trackReady;
      },
      {},
      Boolean(TRACK),
    ).catch(() => new Promise(r => setTimeout(r, 1500)));
    await page.waitForFunction(
      () => {
        const s = window.__hudState?.();
        return !s?.track || s.track.points?.length > 0;
      },
      { timeout: 10000 },
    ).catch(() => new Promise(r => setTimeout(r, 1500)));

    const totalFrames = Math.max(0, Math.ceil(DURATION_FRAMES));
    const pad = String(totalFrames).length;

    let ffmpeg = null;
    let ffmpegExit = null;
    if (pipeToFfmpeg) {
      const ffmpegArgs = ext === '.webm'
        ? [
            '-y',
            '-f', 'image2pipe',
            '-c:v', 'png',
            '-framerate', String(FPS),
            '-i', '-',
            '-c:v', 'libvpx-vp9',
            '-pix_fmt', 'yuva420p',
            '-b:v', '0',
            '-crf', '28',
            outPath,
          ]
        : [
            '-y',
            '-f', 'image2pipe',
            '-c:v', 'png',
            '-framerate', String(FPS),
            '-i', '-',
            '-c:v', 'prores_ks',
            '-profile:v', '4',
            '-pix_fmt', 'yuva444p10le',
            '-timecode', outputTimecode,
            '-metadata', `timecode=${outputTimecode}`,
            outPath,
          ];
      ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
      ffmpeg.stdin.on('error', () => {});
      ffmpegExit = new Promise((res, rej) => {
        ffmpeg.on('error', rej);
        ffmpeg.on('exit', code => (code === 0 ? res(null) : rej(new Error(`ffmpeg exited ${code}`))));
      });
    }

    console.log(`[export] rendering ${totalFrames} frames at ${FPS}fps (${WIDTH}x${HEIGHT})`);
    for (let i = 0; i < totalFrames; i++) {
      const t = i / FPS;
      await page.evaluate(async time => {
        window.seekTo(time);
        await window.readyForFrame();
      }, t);
      const buf = await page.screenshot({
        omitBackground: true,
        type: 'png',
        optimizeForSpeed: true,
      });
      if (ffmpeg) {
        if (!ffmpeg.stdin.write(buf)) {
          await new Promise(r => ffmpeg.stdin.once('drain', r));
        }
      } else {
        const file = resolve(framesDir, `frame_${String(i).padStart(pad, '0')}.png`);
        await writeFile(file, buf);
      }
      if (i % FPS === 0) process.stdout.write(`\r[export] frame ${i}/${totalFrames}`);
    }
    process.stdout.write('\n');

    await browser.close();

    if (ffmpeg) {
      ffmpeg.stdin.end();
      await ffmpegExit;
      console.log(`[export] wrote ${outPath}`);
    } else {
      console.log(`[export] frames kept at ${framesDir} (no video muxing for extension ${ext})`);
    }
  } finally {
    if (previewProcess) previewProcess.kill();
    if (localServer) await localServer.close();
  }
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('exit', c => (c === 0 ? res(null) : rej(new Error(`${cmd} exited ${c}`))));
  });
}

function contentTypeFor(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.csv':
      return 'text/csv; charset=utf-8';
    case '.gpx':
      return 'application/gpx+xml; charset=utf-8';
    case '.geojson':
      return 'application/geo+json; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
