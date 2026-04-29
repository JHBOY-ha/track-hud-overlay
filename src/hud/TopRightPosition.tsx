import type { TelemetrySample } from '../data/schema';
import { Draggable } from './Draggable';

interface Props {
  sample: TelemetrySample | null;
}

export function TopRightPosition({ sample }: Props) {
  const cur = sample?.positionCurrent ?? 1;
  const tot = sample?.positionTotal ?? 2;

  const pips = Array.from({ length: tot }, (_, i) => {
    const rank = i + 1;
    if (rank === cur) return 'me' as const;
    if (rank < cur) return 'ahead' as const;
    return 'behind' as const;
  });

  return (
    <Draggable
      id="topRight.position"
      anchor="tr"
      style={{
        position: 'absolute',
        top: 36,
        right: 48,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 6,
        filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.55))',
      }}
    >
      <div className="label">Grid Position</div>
      <div
        className="tnum"
        style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}
      >
        <span
          style={{
            fontSize: 72,
            fontWeight: 900,
            lineHeight: 0.9,
            color: 'var(--amber)',
          }}
        >
          {cur}
        </span>
        <span
          className="mono"
          style={{ fontSize: 20, color: 'var(--ink-dim)' }}
        >
          / {tot}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
        {pips.map((k, i) => (
          <span
            key={i}
            style={{
              width: 14,
              height: 4,
              background:
                k === 'me'
                  ? 'var(--amber)'
                  : k === 'ahead'
                    ? 'rgba(255,255,255,0.45)'
                    : 'rgba(255,255,255,0.2)',
              boxShadow: k === 'me' ? '0 0 8px var(--amber-dim)' : 'none',
            }}
          />
        ))}
      </div>
    </Draggable>
  );
}
