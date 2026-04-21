import type { TelemetrySample } from '../data/schema';
import { Draggable } from './Draggable';

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
  const progress = sample?.progress ?? 0;
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
        <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{formatElapsed(currentTime)}</b>
      </div>
    </Draggable>
  );
}
