import { useRef } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import { usePlayback, type WidgetId } from '../playback/store';

export type Anchor = 'tl' | 'tr' | 'bl' | 'br';

interface Props {
  id: WidgetId;
  anchor?: Anchor;
  children: ReactNode;
  style?: CSSProperties;
  // When true, Draggable still tracks scale (for the resize handle) but does
  // NOT apply `transform: scale(...)` — the widget handles sizing itself.
  // Use for widgets with 3D/CSS-filter descendants that would otherwise be
  // rasterized pre-scale and become blurry.
  manualScale?: boolean;
}

const ORIGIN: Record<Anchor, string> = {
  tl: 'top left',
  tr: 'top right',
  bl: 'bottom left',
  br: 'bottom right',
};

const HANDLE_SIZE = 14;

function handleStyle(anchor: Anchor, invScale: number): CSSProperties {
  const opp: Anchor = ((anchor[0] === 't' ? 'b' : 't') +
    (anchor[1] === 'l' ? 'r' : 'l')) as Anchor;
  const style: CSSProperties = {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    background: 'rgba(108, 204, 255, 0.9)',
    border: '1px solid #001',
    borderRadius: 2,
    pointerEvents: 'auto',
    zIndex: 2,
    transform: `scale(${invScale})`,
    transformOrigin: ORIGIN[opp],
  };
  if (opp[0] === 't') style.top = -HANDLE_SIZE / 2;
  else style.bottom = -HANDLE_SIZE / 2;
  if (opp[1] === 'l') style.left = -HANDLE_SIZE / 2;
  else style.right = -HANDLE_SIZE / 2;
  style.cursor = opp === 'tl' || opp === 'br' ? 'nwse-resize' : 'nesw-resize';
  return style;
}

// Keys of the user-provided style that position the outer box. Everything else
// (layout, sizing, filter, text) stays on the inner scaled element so widget
// layout remains untouched.
const POSITION_KEYS = ['position', 'left', 'right', 'top', 'bottom', 'filter'] as const;

export function Draggable({ id, anchor = 'tl', children, style, manualScale = false }: Props) {
  const widget = usePlayback(s => s.layout[id]);
  const editMode = usePlayback(s => s.editMode);
  const exporterMode = usePlayback(s => s.exporterMode);
  const stageScale = usePlayback(s => s.stageScale);

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  const resizeRef = useRef<{
    pointerId: number;
    anchorClientX: number;
    anchorClientY: number;
    d0: number;
    baseScale: number;
  } | null>(null);

  const active = editMode && !exporterMode;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!active) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: widget.x,
      baseY: widget.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!active || !dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    const scale = stageScale || 1;
    const dx = (e.clientX - dragRef.current.startX) / scale;
    const dy = (e.clientY - dragRef.current.startY) / scale;
    usePlayback.getState().setWidgetOffset(
      id,
      Math.round(dragRef.current.baseX + dx),
      Math.round(dragRef.current.baseY + dy),
    );
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!active) return;
    e.stopPropagation();
    e.preventDefault();
    const handle = e.currentTarget;
    const wrap = handle.parentElement as HTMLElement | null;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const anchorClientX = anchor[1] === 'l' ? rect.left : rect.right;
    const anchorClientY = anchor[0] === 't' ? rect.top : rect.bottom;
    const d0 = Math.hypot(e.clientX - anchorClientX, e.clientY - anchorClientY);
    if (d0 < 1) return;
    handle.setPointerCapture(e.pointerId);
    resizeRef.current = {
      pointerId: e.pointerId,
      anchorClientX,
      anchorClientY,
      d0,
      baseScale: widget.scale,
    };
  };

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r || r.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const d1 = Math.hypot(e.clientX - r.anchorClientX, e.clientY - r.anchorClientY);
    const next = r.baseScale * (d1 / r.d0);
    usePlayback.getState().setWidgetScale(id, Math.round(next * 1000) / 1000);
  };

  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId === e.pointerId) {
      resizeRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Split style: outer gets only positioning (so its layout box is unscaled),
  // inner gets everything else plus the translate+scale transform. This keeps
  // any ancestor CSS filter on `inner` from being rasterized pre-scale.
  const outerStyle: CSSProperties = {
    pointerEvents: active ? 'auto' : 'none',
    touchAction: active ? 'none' : 'auto',
  };
  const innerStyle: CSSProperties = { ...(style ?? {}) };
  for (const k of POSITION_KEYS) {
    if (style && k in style) {
      (outerStyle as Record<string, unknown>)[k] = (style as Record<string, unknown>)[k];
      delete (innerStyle as Record<string, unknown>)[k];
    }
  }

  const effectiveScale = manualScale ? 1 : widget.scale;
  const invScale = effectiveScale > 0 ? 1 / effectiveScale : 1;

  return (
    <div
      style={outerStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        style={{
          ...innerStyle,
          transform: `translate(${widget.x}px, ${widget.y}px) scale(${effectiveScale})`,
          transformOrigin: ORIGIN[anchor],
          outline: active ? '1px dashed rgba(108, 204, 255, 0.7)' : 'none',
          outlineOffset: active ? 4 : 0,
          cursor: active ? 'move' : 'default',
        }}
      >
        {children}
        {active && (
          <>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: -20,
                fontSize: 11,
                fontFamily: 'system-ui, sans-serif',
                background: 'rgba(108, 204, 255, 0.85)',
                color: '#001',
                padding: '2px 6px',
                borderRadius: 3,
                letterSpacing: 0,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                transform: `scale(${invScale})`,
                transformOrigin: 'top left',
              }}
            >
              {id} · {widget.x}, {widget.y} · {widget.scale.toFixed(2)}×
            </div>
            <div
              style={handleStyle(anchor, invScale)}
              onPointerDown={onResizeDown}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
            />
          </>
        )}
      </div>
    </div>
  );
}
