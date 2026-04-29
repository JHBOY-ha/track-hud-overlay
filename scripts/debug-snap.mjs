#!/usr/bin/env node
// Offline harness for tuning the snap-to-roads algorithm.
//
// Usage:
//   node scripts/debug-snap.mjs <enriched.geojson> [--max=5]
//
// Loads driven + reference layers, projects them into a local planar
// frame, runs the current snap implementation, and emits:
//   - console metrics (snapped %, way switches, single-sample flips,
//     mean/p95 deviation from raw, longest unsnapped run)
//   - <enriched>_snapdebug.geojson — a colour-tagged feature collection
//     you can drop into geojson.io to inspect.
//
// Run with --experimental-strip-types so it can import the TS module.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename, dirname, join } from 'node:path';
import { snapPointsToSegments, buildSegments } from '../src/util/snapToRoads.ts';

const args = process.argv.slice(2);
const inFile = args.find(a => !a.startsWith('--'));
if (!inFile) {
  console.error('usage: debug-snap.mjs <enriched.geojson> [--max=5]');
  process.exit(1);
}
const maxDistM = Number(args.find(a => a.startsWith('--max='))?.slice(6) ?? 5);

const path = resolve(inFile);
console.log(`# loading ${path}`);
const geo = JSON.parse(readFileSync(path, 'utf8'));

const drivenFeats = [];
const referenceFeats = [];
for (const f of geo.features ?? []) {
  if (!f.geometry || f.geometry.type !== 'LineString') continue;
  const kind = (f.properties?.kind ?? '').toLowerCase();
  if (kind === 'driven') drivenFeats.push(f);
  else if (kind === 'reference') referenceFeats.push(f);
}
if (drivenFeats.length === 0) {
  console.error('no driven feature found');
  process.exit(2);
}
const driven = drivenFeats[0];
console.log(`# driven points: ${driven.geometry.coordinates.length}`);
console.log(`# reference ways: ${referenceFeats.length}`);

// ---- planar projection (replica of src/util/projection.ts) ----
const EARTH_R = 6378137;
const allLonLats = [];
for (const c of driven.geometry.coordinates) allLonLats.push(c);
for (const f of referenceFeats) for (const c of f.geometry.coordinates) allLonLats.push(c);
let sumLat = 0;
for (const p of allLonLats) sumLat += p[1];
const centerLat = sumLat / allLonLats.length;
const cosLat = Math.cos((centerLat * Math.PI) / 180);
const originLon = allLonLats[0][0];
const originLat = allLonLats[0][1];
const project = ([lon, lat]) => ({
  x: ((lon - originLon) * Math.PI * EARTH_R * cosLat) / 180,
  y: -((lat - originLat) * Math.PI * EARTH_R) / 180,
});
const unproject = ({ x, y }) => [
  originLon + (x * 180) / (Math.PI * EARTH_R * cosLat),
  originLat - (y * 180) / (Math.PI * EARTH_R),
];

const drivenXY = driven.geometry.coordinates.map(project);
const refXY = referenceFeats.map(f => f.geometry.coordinates.map(project));

// ---- run snap ----
console.log(`# building segments (maxDistM=${maxDistM})...`);
const segments = buildSegments(refXY);
console.log(`# segments: ${segments.length}, unique wayIds after union: ${new Set(segments.map(s => s.wayId)).size}`);
const t0 = performance.now();
const snapped = snapPointsToSegments(drivenXY, segments, maxDistM);
console.log(`# snap elapsed: ${(performance.now() - t0).toFixed(0)} ms`);

// ---- metrics ----
let displaced = 0;
let staticEq = 0; // points identical to raw (unsnapped, since snap returns raw)
const offsets = [];
for (let i = 0; i < drivenXY.length; i++) {
  const dx = snapped[i].x - drivenXY[i].x;
  const dy = snapped[i].y - drivenXY[i].y;
  const d = Math.hypot(dx, dy);
  offsets.push(d);
  if (d > 1e-6) displaced++;
  else staticEq++;
}
const offsetsByIndex = offsets.slice();
const sortedOffsets = offsets.slice().sort((a, b) => a - b);
const median = sortedOffsets[Math.floor(sortedOffsets.length / 2)];
const p95 = sortedOffsets[Math.floor(sortedOffsets.length * 0.95)];
const max = sortedOffsets[sortedOffsets.length - 1];
const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
console.log(`\n## snap stats`);
console.log(`  displaced (snapped): ${displaced} / ${drivenXY.length} = ${(100 * displaced / drivenXY.length).toFixed(1)}%`);
console.log(`  unsnapped:           ${staticEq} (${(100 * staticEq / drivenXY.length).toFixed(1)}%)`);
console.log(`  offset mean: ${mean.toFixed(2)} m, median ${median.toFixed(2)}, p95 ${p95.toFixed(2)}, max ${max.toFixed(2)}`);

// raw distance from each driven point to the nearest reference segment
// (independent of the algorithm) — the floor of what's reachable.
function nearestRefDist(p) {
  let best = Infinity;
  for (const s of segments) {
    let t = s.len2 > 0 ? ((p.x - s.ax) * s.dx + (p.y - s.ay) * s.dy) / s.len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const sx = s.ax + t * s.dx;
    const sy = s.ay + t * s.dy;
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d < best) best = d;
  }
  return best;
}
let withinReach = 0;
let unreachableButSnapped = 0;
let reachableButUnsnapped = 0;
const sampleStride = Math.max(1, Math.floor(drivenXY.length / 5000));
const reachables = [];
for (let i = 0; i < drivenXY.length; i += sampleStride) {
  const d = nearestRefDist(drivenXY[i]);
  reachables.push(d);
  const snappedHere = offsetsByIndex[i] > 1e-6;
  if (d <= maxDistM) withinReach++;
  if (d > maxDistM && snappedHere) unreachableButSnapped++;
  if (d <= maxDistM && !snappedHere) reachableButUnsnapped++;
}
console.log(`\n## reachability (sampled every ${sampleStride}, n=${reachables.length})`);
console.log(`  reachable within ${maxDistM} m: ${withinReach} (${(100 * withinReach / reachables.length).toFixed(1)}%)`);
console.log(`  reachable BUT unsnapped (algo bug):  ${reachableButUnsnapped} (${(100 * reachableButUnsnapped / reachables.length).toFixed(1)}%)`);

// ---- analyse way-flicker by reproducing first-pass classification ----
// Re-run a stripped-down version to also recover wayId per point.
function rerunWithWayIds() {
  // Replicate header constants
  const STICKY_RATIO = 0.4;
  const STICKY_MARGIN2 = 0.5;
  const SWITCH_HOLD = 4;
  const SHORT_ISLAND_MAX_POINTS = 200;
  const SHORT_ISLAND_MAX_DIST_M = 10;
  const maxD2 = maxDistM * maxDistM;

  const project1 = (s, p) => {
    let t = s.len2 > 0 ? ((p.x - s.ax) * s.dx + (p.y - s.ay) * s.dy) / s.len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const sx = s.ax + t * s.dx, sy = s.ay + t * s.dy;
    const ddx = p.x - sx, ddy = p.y - sy;
    return { sx, sy, d2: ddx * ddx + ddy * ddy };
  };
  const byWay = new Map();
  for (const s of segments) {
    let arr = byWay.get(s.wayId);
    if (!arr) byWay.set(s.wayId, arr = []);
    arr.push(s);
  }
  const bestOnWay = (wayId, p) => {
    const segs = byWay.get(wayId);
    if (!segs) return null;
    let best = null;
    for (const s of segs) {
      const pr = project1(s, p);
      if (!best || pr.d2 < best.d2) best = pr;
    }
    return best;
  };
  const first = drivenXY.map((p, i) => {
    let bestD2 = Infinity, bestSx = p.x, bestSy = p.y, bestWay = -1;
    for (const s of segments) {
      const pr = project1(s, p);
      if (pr.d2 < bestD2) { bestD2 = pr.d2; bestSx = pr.sx; bestSy = pr.sy; bestWay = s.wayId; }
    }
    if (bestD2 > maxD2) return { x: p.x, y: p.y, wayId: -1, d2: bestD2 };
    return { x: bestSx, y: bestSy, wayId: bestWay, d2: bestD2 };
  });

  let curWay = -1, pendingWay = -1, pendingCount = 0;
  const ways = new Array(drivenXY.length);
  const out = drivenXY.map((p, i) => {
    const ownBest = curWay >= 0 ? bestOnWay(curWay, p) : null;
    const fb = first[i];
    if (fb.wayId < 0) {
      curWay = -1; pendingWay = -1; pendingCount = 0;
      ways[i] = -1; return fb;
    }
    if (curWay < 0) {
      curWay = fb.wayId; pendingWay = -1; pendingCount = 0;
      ways[i] = fb.wayId; return fb;
    }
    if (fb.wayId === curWay) {
      pendingWay = -1; pendingCount = 0;
      ways[i] = curWay; return fb;
    }
    const ownReachable = ownBest !== null && ownBest.d2 <= maxD2;
    const winsRatio = ownBest ? fb.d2 < STICKY_RATIO * ownBest.d2 : true;
    const winsMargin = ownBest ? ownBest.d2 - fb.d2 >= STICKY_MARGIN2 : true;
    const candidateBeatsOwn = !ownReachable || (winsRatio && winsMargin);
    if (!ownReachable) {
      curWay = fb.wayId; pendingWay = -1; pendingCount = 0;
      ways[i] = fb.wayId; return fb;
    }
    if (candidateBeatsOwn) {
      if (pendingWay === fb.wayId) pendingCount++;
      else { pendingWay = fb.wayId; pendingCount = 1; }
      if (pendingCount >= SWITCH_HOLD) {
        curWay = fb.wayId; pendingWay = -1; pendingCount = 0;
        ways[i] = fb.wayId; return fb;
      }
    } else {
      pendingWay = -1; pendingCount = 0;
    }
    ways[i] = curWay;
    return { x: ownBest.sx, y: ownBest.sy, wayId: curWay, d2: ownBest.d2 };
  });
  // smoothing pass — same as in source
  for (let start = 0; start < out.length;) {
    let end = start + 1;
    while (end < out.length && ways[end] === ways[start]) end++;
    const islandWay = ways[start];
    const surroundingWay =
      start > 0 && end < out.length && ways[start - 1] === ways[end]
        ? ways[start - 1]
        : -1;
    if (islandWay >= 0 && surroundingWay >= 0 && islandWay !== surroundingWay) {
      const pointCount = end - start;
      let islandDist = 0;
      for (let i = start + 1; i < end; i++) {
        islandDist += Math.hypot(drivenXY[i].x - drivenXY[i - 1].x, drivenXY[i].y - drivenXY[i - 1].y);
      }
      if (pointCount <= SHORT_ISLAND_MAX_POINTS && islandDist <= SHORT_ISLAND_MAX_DIST_M) {
        const replacements = [];
        for (let i = start; i < end; i++) {
          const best = bestOnWay(surroundingWay, drivenXY[i]);
          if (!best || best.d2 > maxD2) {
            replacements.length = 0;
            break;
          }
          replacements.push({ x: best.sx, y: best.sy, wayId: surroundingWay, d2: best.d2 });
        }
        if (replacements.length === pointCount) {
          for (let i = start; i < end; i++) {
            out[i] = replacements[i - start];
            ways[i] = surroundingWay;
          }
        }
      }
    }
    start = end;
  }
  return { out, ways, first };
}
const dbg = rerunWithWayIds();
const { ways, first } = dbg;

// Why is first-pass rejecting so many?
let firstUnreached = 0, firstReached = 0;
const headingLens = [];
for (let i = 0; i < first.length; i++) {
  if (first[i].wayId < 0) firstUnreached++; else firstReached++;
}
// recompute headings here for stats
{
  const HEADING_BASELINE_M = 2.0;
  for (let i = 0; i < drivenXY.length; i += Math.max(1, Math.floor(drivenXY.length / 1000))) {
    let fx = drivenXY[i].x, fy = drivenXY[i].y, fAcc = 0;
    for (let j = i + 1; j < drivenXY.length; j++) {
      const d = Math.hypot(drivenXY[j].x - fx, drivenXY[j].y - fy);
      fx = drivenXY[j].x; fy = drivenXY[j].y; fAcc += d;
      if (fAcc >= HEADING_BASELINE_M) break;
    }
    let bx = drivenXY[i].x, by = drivenXY[i].y, bAcc = 0;
    for (let j = i - 1; j >= 0; j--) {
      const d = Math.hypot(bx - drivenXY[j].x, by - drivenXY[j].y);
      bx = drivenXY[j].x; by = drivenXY[j].y; bAcc += d;
      if (bAcc >= HEADING_BASELINE_M) break;
    }
    headingLens.push(Math.hypot(fx - bx, fy - by));
  }
}
headingLens.sort((a, b) => a - b);
// Direct test: just point 0 against all segments, no algorithm wrapper.
{
  const p = drivenXY[0];
  let best = Infinity, who = null;
  for (const s of segments) {
    if (s.len2 <= 0) continue;
    let t = ((p.x - s.ax) * s.dx + (p.y - s.ay) * s.dy) / s.len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const sx = s.ax + t * s.dx, sy = s.ay + t * s.dy;
    const d2 = (p.x - sx) ** 2 + (p.y - sy) ** 2;
    if (d2 < best) { best = d2; who = s; }
  }
  console.log(`\n## raw nearest at i=0: d=${Math.sqrt(best).toFixed(2)} m, wayId=${who?.wayId}, len2=${who?.len2.toFixed(2)}`);
  // Try the actual snap function on 1 point
  const oneSnap = snapPointsToSegments([p], segments, 5);
  console.log(`  snapPointsToSegments([p],…)[0] = (${oneSnap[0].x.toFixed(2)},${oneSnap[0].y.toFixed(2)}) vs raw (${p.x.toFixed(2)},${p.y.toFixed(2)})`);
  // Try with first 100 points
  const slice = drivenXY.slice(0, 100);
  const sliceSnap = snapPointsToSegments(slice, segments, 5);
  let sliceDispl = 0;
  for (let i = 0; i < slice.length; i++) {
    if (Math.hypot(sliceSnap[i].x - slice[i].x, sliceSnap[i].y - slice[i].y) > 1e-6) sliceDispl++;
  }
  console.log(`  first 100 sliced snap: ${sliceDispl}/100 displaced`);
}
// Why are points 0..3396 unsnapped? Sample several.
{
  for (const i of [0, 100, 500, 1500, 3000, 3500, 5000]) {
    // Probe: nearest seg direction at this i, and cos with heading.
    if (i < drivenXY.length) {
      let bestD = Infinity, bestSeg = null;
      for (const s of segments) {
        let t = s.len2 > 0 ? ((drivenXY[i].x - s.ax) * s.dx + (drivenXY[i].y - s.ay) * s.dy) / s.len2 : 0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const sx = s.ax + t * s.dx, sy = s.ay + t * s.dy;
        const d = Math.hypot(drivenXY[i].x - sx, drivenXY[i].y - sy);
        if (d < bestD) { bestD = d; bestSeg = s; }
      }
      if (bestSeg) {
        const segLen = Math.sqrt(bestSeg.len2);
        // Use 2m baseline heading
        let fx = drivenXY[i].x, fy = drivenXY[i].y, fAcc = 0;
        for (let j = i + 1; j < drivenXY.length; j++) {
          const d = Math.hypot(drivenXY[j].x - fx, drivenXY[j].y - fy);
          fx = drivenXY[j].x; fy = drivenXY[j].y; fAcc += d;
          if (fAcc >= 2) break;
        }
        let bx = drivenXY[i].x, by = drivenXY[i].y, bAcc = 0;
        for (let j = i - 1; j >= 0; j--) {
          const d = Math.hypot(bx - drivenXY[j].x, by - drivenXY[j].y);
          bx = drivenXY[j].x; by = drivenXY[j].y; bAcc += d;
          if (bAcc >= 2) break;
        }
        const hx = fx - bx, hy = fy - by, hL = Math.hypot(hx, hy);
        const cos = hL > 0 ? (hx * bestSeg.dx + hy * bestSeg.dy) / (segLen * hL) : 0;
        console.log(`    seg dir=(${bestSeg.dx.toFixed(2)},${bestSeg.dy.toFixed(2)}) segLen=${segLen.toFixed(2)} cos=${cos.toFixed(2)} |cos|=${Math.abs(cos).toFixed(2)}`);
      }
    }
    if (i >= drivenXY.length) continue;
    const HEADING_BASELINE_M = 2.0;
    let fx = drivenXY[i].x, fy = drivenXY[i].y, fAcc = 0;
    for (let j = i + 1; j < drivenXY.length; j++) {
      const d = Math.hypot(drivenXY[j].x - fx, drivenXY[j].y - fy);
      fx = drivenXY[j].x; fy = drivenXY[j].y; fAcc += d;
      if (fAcc >= HEADING_BASELINE_M) break;
    }
    let bx = drivenXY[i].x, by = drivenXY[i].y, bAcc = 0;
    for (let j = i - 1; j >= 0; j--) {
      const d = Math.hypot(bx - drivenXY[j].x, by - drivenXY[j].y);
      bx = drivenXY[j].x; by = drivenXY[j].y; bAcc += d;
      if (bAcc >= HEADING_BASELINE_M) break;
    }
    const hLen = Math.hypot(fx - bx, fy - by);
    const dRef = nearestRefDist(drivenXY[i]);
    console.log(`  i=${i}: hLen=${hLen.toFixed(2)}, distToRef=${dRef.toFixed(2)}, snapDelta=${offsetsByIndex[i].toFixed(3)}`);
  }
}
// Pick a point with heading and see what happens with the closest segment.
{
  const HEADING_BASELINE_M = 2.0;
  const i = Math.floor(drivenXY.length / 2);
  let fx = drivenXY[i].x, fy = drivenXY[i].y, fAcc = 0;
  for (let j = i + 1; j < drivenXY.length; j++) {
    const d = Math.hypot(drivenXY[j].x - fx, drivenXY[j].y - fy);
    fx = drivenXY[j].x; fy = drivenXY[j].y; fAcc += d;
    if (fAcc >= HEADING_BASELINE_M) break;
  }
  let bx = drivenXY[i].x, by = drivenXY[i].y, bAcc = 0;
  for (let j = i - 1; j >= 0; j--) {
    const d = Math.hypot(bx - drivenXY[j].x, by - drivenXY[j].y);
    bx = drivenXY[j].x; by = drivenXY[j].y; bAcc += d;
    if (bAcc >= HEADING_BASELINE_M) break;
  }
  const hx = fx - bx, hy = fy - by, hLen = Math.hypot(hx, hy);
  let bestD = Infinity, bestSeg = null;
  for (const s of segments) {
    let t = s.len2 > 0 ? ((drivenXY[i].x - s.ax) * s.dx + (drivenXY[i].y - s.ay) * s.dy) / s.len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const sx = s.ax + t * s.dx, sy = s.ay + t * s.dy;
    const d = Math.hypot(drivenXY[i].x - sx, drivenXY[i].y - sy);
    if (d < bestD) { bestD = d; bestSeg = s; }
  }
  if (bestSeg) {
    const segLen = Math.sqrt(bestSeg.len2);
    const cos = (hx * bestSeg.dx + hy * bestSeg.dy) / (segLen * hLen);
    console.log(`\n## diag at i=${i}: heading=(${hx.toFixed(2)},${hy.toFixed(2)}) len=${hLen.toFixed(2)}, nearest seg dir=(${bestSeg.dx.toFixed(2)},${bestSeg.dy.toFixed(2)}) len=${segLen.toFixed(2)}, dist=${bestD.toFixed(2)}, cos=${cos.toFixed(2)}, wayId=${bestSeg.wayId}`);
  }
}
console.log(`\n## first-pass classification`);
console.log(`  first.wayId >= 0: ${firstReached}, first.wayId == -1: ${firstUnreached}`);
console.log(`  heading length (sampled): median ${headingLens[Math.floor(headingLens.length/2)].toFixed(2)}, p10 ${headingLens[Math.floor(headingLens.length*0.1)].toFixed(2)}, p90 ${headingLens[Math.floor(headingLens.length*0.9)].toFixed(2)}, max ${headingLens[headingLens.length-1].toFixed(2)}`);


let switches = 0, fbDifferentFromCur = 0;
for (let i = 1; i < ways.length; i++) {
  if (ways[i] !== ways[i - 1] && ways[i] >= 0 && ways[i - 1] >= 0) switches++;
  if (first[i].wayId >= 0 && ways[i] >= 0 && first[i].wayId !== ways[i]) fbDifferentFromCur++;
}
let unsnappedRuns = 0, longestRun = 0, run = 0;
for (let i = 0; i < drivenXY.length; i++) {
  if (offsetsByIndex[i] < 1e-6) {
    run++;
    longestRun = Math.max(longestRun, run);
  } else {
    if (run > 0) unsnappedRuns++;
    run = 0;
  }
}
if (run > 0) unsnappedRuns++;

// Find the start index of each unsnapped run >50 pts and dump.
{
  const runs = [];
  let s = -1;
  for (let i = 0; i < drivenXY.length; i++) {
    const isUn = offsetsByIndex[i] < 1e-6;
    if (isUn && s < 0) s = i;
    else if (!isUn && s >= 0) { if (i - s >= 50) runs.push([s, i - 1]); s = -1; }
  }
  if (s >= 0) runs.push([s, drivenXY.length - 1]);
  if (runs.length) {
    console.log(`\n## long unsnapped runs (>=50 pts):`);
    for (const [a, b] of runs.slice(0, 10)) {
      const mid = Math.floor((a + b) / 2);
      const ll = unproject(drivenXY[mid]);
      const dRef = nearestRefDist(drivenXY[mid]);
      console.log(`  i=[${a}..${b}] (${b-a+1} pts), mid lon/lat ${ll[0].toFixed(6)},${ll[1].toFixed(6)}, mid distToRef=${dRef.toFixed(2)}m`);
    }
  }
}
console.log(`\n## algorithm behaviour`);
console.log(`  way switches (committed): ${switches}`);
console.log(`  points where global-best differed from current way: ${fbDifferentFromCur} (${(100 * fbDifferentFromCur / drivenXY.length).toFixed(1)}%)`);
console.log(`  unsnapped runs: ${unsnappedRuns}, longest: ${longestRun} pts`);

// Short way islands are the usual visible "one shake at a fork": A...B...A
// where B lasts longer than the single-point smoothing pass can fix.
{
  const runRows = [];
  let start = 0;
  for (let i = 1; i <= ways.length; i++) {
    if (i < ways.length && ways[i] === ways[start]) continue;
    const prevWay = start > 0 ? ways[start - 1] : -1;
    const nextWay = i < ways.length ? ways[i] : -1;
    const len = i - start;
    if (ways[start] >= 0 && len <= 60) {
      const mid = Math.floor((start + i - 1) / 2);
      const ll = unproject(drivenXY[mid]);
      runRows.push({ start, end: i - 1, len, way: ways[start], prevWay, nextWay, lon: ll[0], lat: ll[1] });
    }
    start = i;
  }
  if (runRows.length) {
    console.log(`\n## short way runs (<=60 pts)`);
    for (const r of runRows.slice(0, 30)) {
      console.log(
        `  i=[${r.start}..${r.end}] len=${r.len} way=${r.way} prev=${r.prevWay} next=${r.nextWay} mid=${r.lon.toFixed(6)},${r.lat.toFixed(6)}`,
      );
    }
  }
}

// Histogram of nearestRefDist for unsnapped points (to see whether the
// algorithm is rejecting reachable points or they really are too far).
const buckets = [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 1e9];
const hist = new Array(buckets.length - 1).fill(0);
for (let i = 0; i < drivenXY.length; i += sampleStride) {
  if (offsetsByIndex[i] > 1e-6) continue;
  const d = nearestRefDist(drivenXY[i]);
  for (let b = 0; b < buckets.length - 1; b++) {
    if (d >= buckets[b] && d < buckets[b + 1]) { hist[b]++; break; }
  }
}
console.log(`\n## unsnapped points by distance to nearest ref segment (sampled)`);
for (let b = 0; b < buckets.length - 1; b++) {
  if (hist[b] === 0) continue;
  console.log(`  [${buckets[b]}, ${buckets[b + 1]}) m: ${hist[b]}`);
}

// ---- emit colourised debug GeoJSON ----
const outPath = join(dirname(path), basename(path).replace(/\.geojson$/, '_snapdebug.geojson'));
const features = [];
// reference ways in grey
for (let i = 0; i < referenceFeats.length; i++) {
  features.push({
    type: 'Feature',
    properties: { kind: 'reference', name: referenceFeats[i].properties?.name, stroke: '#666' },
    geometry: referenceFeats[i].geometry,
  });
}
// raw driven in red
features.push({
  type: 'Feature',
  properties: { kind: 'driven_raw', stroke: '#e44', 'stroke-width': 1 },
  geometry: { type: 'LineString', coordinates: driven.geometry.coordinates },
});
// snapped driven in green
features.push({
  type: 'Feature',
  properties: { kind: 'driven_snapped', stroke: '#2c9', 'stroke-width': 2 },
  geometry: {
    type: 'LineString',
    coordinates: snapped.map(unproject),
  },
});
// flag suspicious points: way changed from previous AND back within K samples
const suspicionWindow = 8;
for (let i = 1; i < ways.length - suspicionWindow; i++) {
  if (ways[i] < 0) continue;
  if (ways[i] === ways[i - 1]) continue;
  // look ahead — does it flip back within suspicionWindow?
  for (let k = 1; k <= suspicionWindow; k++) {
    if (ways[i + k] === ways[i - 1] && ways[i + k] >= 0) {
      features.push({
        type: 'Feature',
        properties: { kind: 'flicker', i, length: k, fromWay: ways[i - 1], toWay: ways[i], 'marker-color': '#f0f' },
        geometry: { type: 'Point', coordinates: unproject(drivenXY[i]) },
      });
      break;
    }
  }
}
writeFileSync(outPath, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`\n# wrote debug geojson: ${outPath}`);
