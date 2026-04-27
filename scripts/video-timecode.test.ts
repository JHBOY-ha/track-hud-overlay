import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMp4Timecode } from '../src/util/videoTimecode.ts';

const enc = new TextEncoder();

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

function i32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, n);
  return out;
}

function bytes(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function str(s: string): Uint8Array {
  return enc.encode(s);
}

function box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const payload = bytes(...payloads);
  return bytes(u32(payload.length + 8), str(type), payload);
}

function makeTmcdMp4(frameCount: number, layout: 'mp4' | 'quicktime' = 'mp4'): Uint8Array {
  const mdatPayload = i32(frameCount);
  const mdat = box('mdat', mdatPayload);
  const mdatPayloadOffset = 8;

  const hdlr = box(
    'hdlr',
    new Uint8Array(8),
    str('tmcd'),
    new Uint8Array(12),
    str('Timecode'),
    new Uint8Array([0]),
  );
  const tmcdEntry =
    layout === 'quicktime'
      ? box(
          'tmcd',
          new Uint8Array(8),
          u32(0),
          u32(2),
          u32(24000),
          u32(1000),
          new Uint8Array([24, 0, 0, 0]),
        )
      : box(
          'tmcd',
          new Uint8Array(8),
          u32(0),
          u32(60),
          u32(1),
          new Uint8Array([60, 0, 0, 0]),
        );
  const stsd = box('stsd', new Uint8Array(4), u32(1), tmcdEntry);
  const stsz = box('stsz', new Uint8Array(4), u32(4), u32(1));
  const stco = box('stco', new Uint8Array(4), u32(1), u32(mdatPayloadOffset));
  const stbl = box('stbl', stsd, stsz, stco);
  const minf = box('minf', stbl);
  const mdia = box('mdia', hdlr, minf);
  const trak = box('trak', mdia);
  const moov = box('moov', trak);

  return bytes(mdat, moov);
}

test('parseMp4Timecode reads a QuickTime tmcd track start frame', () => {
  const frameCount = 18 * 60 * 60 * 60 + 12;
  const parsed = parseMp4Timecode(makeTmcdMp4(frameCount).buffer);

  assert.deepEqual(parsed, {
    seconds: 64800.2,
    fps: 60,
    frameCount,
  });
});

test('parseMp4Timecode reads Ronin 4D style QuickTime tmcd entries', () => {
  const frameCount = 19 * 60 * 24 + 46 * 24 + 16;
  const parsed = parseMp4Timecode(makeTmcdMp4(frameCount, 'quicktime').buffer);

  assert.deepEqual(parsed, {
    seconds: frameCount / 24,
    fps: 24,
    frameCount,
  });
});

test('parseMp4Timecode returns null when no tmcd track exists', () => {
  const mp4 = bytes(box('mdat', new Uint8Array([1, 2, 3, 4])), box('moov'));
  assert.equal(parseMp4Timecode(mp4.buffer), null);
});
