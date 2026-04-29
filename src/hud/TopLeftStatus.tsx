import type { TelemetrySample, TrackPoint } from '../data/schema';
import { Draggable } from './Draggable';
import { usePlayback } from '../playback/store';

/** Cumulative distance along the primary track at absolute time `t`.
 *  Returns null if the track has no time-tagged points or `t` is outside. */
function distanceAtTime(points: TrackPoint[], trackOffset: number, t: number): number | null {
  if (points.length === 0 || points[0].t === undefined) return null;
  const local = t - trackOffset;
  const first = points[0].t!;
  const last = points[points.length - 1].t ?? first;
  if (local <= first) return points[0].distance;
  if (local >= last) return points[points.length - 1].distance;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((points[mid].t ?? 0) <= local) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[lo + 1];
  const f = (local - (a.t ?? 0)) / (((b.t ?? 0) - (a.t ?? 0)) || 1);
  return a.distance + (b.distance - a.distance) * f;
}

interface Props {
  sample: TelemetrySample | null;
  currentTime: number;
}

function formatElapsed(t: number): string {
  const ms = Math.floor((t - Math.floor(t)) * 1000);
  const s = Math.floor(t) % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

const STRIP_W = 300;
const TICKS = 10;

export function TopLeftStatus({ sample, currentTime }: Props) {
  const progressStart = usePlayback(s => s.progressStart);
  const progressEnd = usePlayback(s => s.progressEnd);
  const absTime = usePlayback(s => s.currentTime);
  const track = usePlayback(s => s.track);
  const trackOffset = usePlayback(s => s.trackOffset);

  const hasRange =
    progressStart !== null && progressEnd !== null && progressEnd > progressStart;

  let progress = sample?.progress ?? 0;
  let elapsed = currentTime;
  if (hasRange) {
    const tStart = progressStart as number;
    const tEnd = progressEnd as number;
    elapsed = Math.max(0, absTime - tStart);
    const pts = track?.points ?? [];
    const dStart = distanceAtTime(pts, trackOffset, tStart);
    const dEnd = distanceAtTime(pts, trackOffset, tEnd);
    const dNow = distanceAtTime(pts, trackOffset, absTime);
    if (dStart !== null && dEnd !== null && dNow !== null && dEnd > dStart) {
      progress = Math.max(0, Math.min(1, (dNow - dStart) / (dEnd - dStart)));
    } else {
      // Fallback to time-based when track has no time-tagged points.
      progress = Math.max(0, Math.min(1, (absTime - tStart) / (tEnd - tStart)));
    }
  }
  const pct = Math.round(progress * 100);

  return (
    <Draggable
      id="topLeft.progress"
      anchor="tl"
      style={{
        position: 'absolute',
        top: 36,
        left: 48,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.55))',
      }}
    >
      <div className="label">Stage Progress</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span
          className="tnum"
          style={{ fontWeight: 900, fontSize: 48, lineHeight: 1, letterSpacing: '-0.01em' }}
        >
          {pct}
        </span>
        <span
          className="mono"
          style={{ fontSize: 12, letterSpacing: '0.18em', color: 'var(--ink-dim)' }}
        >
          %
        </span>
      </div>

      <div
        style={{
          width: STRIP_W,
          height: 7,
          background: 'rgba(255,255,255,0.14)',
          position: 'relative',
          overflow: 'hidden',
          clipPath: 'polygon(0 0, 100% 0, calc(100% - 7px) 100%, 0 100%)',
          marginTop: 2,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: 'var(--amber)',
            boxShadow: '0 0 14px var(--amber-dim)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            justifyContent: 'space-between',
            padding: '0 1px',
          }}
        >
          {Array.from({ length: TICKS }, (_, i) => (
            <span key={i} style={{ width: 1, background: 'rgba(0,0,0,0.35)' }} />
          ))}
        </div>
      </div>

      <div
        className="mono tnum"
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto',
          columnGap: 16,
          rowGap: 2,
          fontSize: 12,
          color: 'var(--ink-dim)',
          marginTop: 10,
        }}
      >
        <span>Elapsed</span>
        <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{formatElapsed(elapsed)}</b>
      </div>
    </Draggable>
  );
}
