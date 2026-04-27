export interface EmbeddedVideoTimecode {
  seconds: number;
  fps: number;
  frameCount: number;
}

interface BoxRef {
  type: string;
  start: number;
  headerSize: number;
  size: number;
  contentStart: number;
  end: number;
}

const CONTAINERS = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'edts',
  'dinf',
  'udta',
  'meta',
]);

function ascii(view: DataView, offset: number, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

function readBox(view: DataView, offset: number, limit: number): BoxRef | null {
  if (offset + 8 > limit) return null;
  let size = view.getUint32(offset);
  const type = ascii(view, offset + 4, 4);
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > limit) return null;
    const hi = view.getUint32(offset + 8);
    const lo = view.getUint32(offset + 12);
    size = hi * 2 ** 32 + lo;
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }
  if (size < headerSize || offset + size > limit) return null;
  return {
    type,
    start: offset,
    headerSize,
    size,
    contentStart: offset + headerSize,
    end: offset + size,
  };
}

function children(view: DataView, parent: BoxRef): BoxRef[] {
  const out: BoxRef[] = [];
  let offset = parent.contentStart;
  if (parent.type === 'meta') offset += 4;
  while (offset + 8 <= parent.end) {
    const box = readBox(view, offset, parent.end);
    if (!box) break;
    out.push(box);
    offset = box.end;
  }
  return out;
}

function findChild(view: DataView, parent: BoxRef, type: string): BoxRef | null {
  return children(view, parent).find(box => box.type === type) ?? null;
}

function findDescendants(view: DataView, parent: BoxRef, type: string): BoxRef[] {
  const out: BoxRef[] = [];
  for (const child of children(view, parent)) {
    if (child.type === type) out.push(child);
    if (CONTAINERS.has(child.type)) out.push(...findDescendants(view, child, type));
  }
  return out;
}

function topLevelBoxes(view: DataView): BoxRef[] {
  const out: BoxRef[] = [];
  let offset = 0;
  while (offset + 8 <= view.byteLength) {
    const box = readBox(view, offset, view.byteLength);
    if (!box) break;
    out.push(box);
    offset = box.end;
  }
  return out;
}

function handlerType(view: DataView, trak: BoxRef): string | null {
  const mdia = findChild(view, trak, 'mdia');
  if (!mdia) return null;
  const hdlr = findChild(view, mdia, 'hdlr');
  if (!hdlr || hdlr.contentStart + 12 > hdlr.end) return null;
  return ascii(view, hdlr.contentStart + 8, 4);
}

function parseTmcdSampleEntry(view: DataView, stsd: BoxRef): { fps: number } | null {
  let offset = stsd.contentStart + 8;
  while (offset + 8 <= stsd.end) {
    const entry = readBox(view, offset, stsd.end);
    if (!entry) break;
    if (entry.type === 'tmcd') {
      const candidates = [
        { timeScaleOffset: 12, frameDurationOffset: 16, framesOffset: 20 },
        { timeScaleOffset: 16, frameDurationOffset: 20, framesOffset: 24 },
      ];
      for (const c of candidates) {
        if (entry.contentStart + c.framesOffset + 1 > entry.end) continue;
        const timeScale = view.getUint32(entry.contentStart + c.timeScaleOffset);
        const frameDuration = view.getUint32(entry.contentStart + c.frameDurationOffset);
        const numberOfFrames = view.getUint8(entry.contentStart + c.framesOffset);
        const fps =
          numberOfFrames > 0
            ? numberOfFrames
            : frameDuration > 0
              ? Math.round(timeScale / frameDuration)
              : 0;
        if (fps > 0 && fps <= 240) return { fps };
      }
    }
    offset = entry.end;
  }
  return null;
}

function firstChunkOffset(view: DataView, trak: BoxRef): number | null {
  const stco = findDescendants(view, trak, 'stco')[0];
  if (stco && stco.contentStart + 12 <= stco.end) {
    const entryCount = view.getUint32(stco.contentStart + 4);
    if (entryCount > 0) return view.getUint32(stco.contentStart + 8);
  }

  const co64 = findDescendants(view, trak, 'co64')[0];
  if (co64 && co64.contentStart + 16 <= co64.end) {
    const entryCount = view.getUint32(co64.contentStart + 4);
    if (entryCount > 0) {
      const hi = view.getUint32(co64.contentStart + 8);
      const lo = view.getUint32(co64.contentStart + 12);
      return hi * 2 ** 32 + lo;
    }
  }

  return null;
}

export function parseMp4Timecode(buffer: ArrayBuffer): EmbeddedVideoTimecode | null {
  const view = new DataView(buffer);
  const moov = topLevelBoxes(view).find(box => box.type === 'moov');
  if (!moov) return null;

  for (const trak of findDescendants(view, moov, 'trak')) {
    if (handlerType(view, trak) !== 'tmcd') continue;

    const stsd = findDescendants(view, trak, 'stsd')[0];
    if (!stsd) continue;
    const entry = parseTmcdSampleEntry(view, stsd);
    if (!entry) continue;

    const sampleOffset = firstChunkOffset(view, trak);
    if (sampleOffset === null || sampleOffset + 4 > view.byteLength) continue;

    const frameCount = view.getInt32(sampleOffset);
    return {
      seconds: frameCount / entry.fps,
      fps: entry.fps,
      frameCount,
    };
  }

  return null;
}
