import { describe, expect, it } from 'vitest';
import { parseWav, wavToChannels } from '../src/audio/wav';
import { decodeRate } from '../src/audio/engine';

function makeWav(samples: number[][], rate: number, bits: 16 | 24 | 8 = 16): Uint8Array {
  const ch = samples.length;
  const frames = samples[0].length;
  const bytes = bits / 8;
  const data = frames * ch * bytes;
  const u8 = new Uint8Array(44 + data);
  const dv = new DataView(u8.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (u8[o + i] = c.charCodeAt(0)));
  w(0, 'RIFF');
  dv.setUint32(4, 36 + data, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * ch * bytes, true);
  dv.setUint16(32, ch * bytes, true);
  dv.setUint16(34, bits, true);
  w(36, 'data');
  dv.setUint32(40, data, true);
  for (let f = 0; f < frames; f++)
    for (let c = 0; c < ch; c++) {
      const p = 44 + (f * ch + c) * bytes;
      const v = samples[c][f];
      if (bits === 16) dv.setInt16(p, Math.round(v * 32767), true);
      else if (bits === 8) u8[p] = Math.round(v * 127 + 128);
      else {
        const x = Math.round(v * 8388607) & 0xffffff;
        u8[p] = x & 255;
        u8[p + 1] = (x >> 8) & 255;
        u8[p + 2] = (x >> 16) & 255;
      }
    }
  return u8;
}

describe('WAV 직접 읽기 (긴 곡 메모리 절약)', () => {
  it('형식 읽기와 같은 표본율 그대로', () => {
    const l = [0, 0.5, -0.5, 0.25];
    const r = [0.1, 0.2, 0.3, 0.4];
    const u8 = makeWav([l, r], 8000);
    const info = parseWav(u8)!;
    expect(info).toMatchObject({ channels: 2, rate: 8000, bits: 16, frames: 4 });
    const out = [new Float32Array(4), new Float32Array(4)];
    wavToChannels(u8, info, out);
    out[0].forEach((v, i) => expect(v).toBeCloseTo(l[i], 3));
    out[1].forEach((v, i) => expect(v).toBeCloseTo(r[i], 3));
  });

  it('표본율 절반으로 줄이면 두 표본 평균 (24비트·8비트도)', () => {
    const l = [0.2, 0.4, -0.6, -0.2];
    for (const bits of [16, 24, 8] as const) {
      const u8 = makeWav([l], 8000, bits);
      const info = parseWav(u8)!;
      const out = [new Float32Array(2)];
      wavToChannels(u8, info, out);
      expect(out[0][0]).toBeCloseTo(0.3, 1);
      expect(out[0][1]).toBeCloseTo(-0.4, 1);
    }
  });

  it('홀수 위치에 있어도 읽는다 (zip 안 파일)', () => {
    const w = makeWav([[0.5, -0.5]], 8000);
    const big = new Uint8Array(w.length + 1);
    big.set(w, 1);
    const u8 = big.subarray(1);
    const out = [new Float32Array(2)];
    wavToChannels(u8, parseWav(u8)!, out);
    expect(out[0][0]).toBeCloseTo(0.5, 3);
  });

  it('WAV가 아니면 null', () => {
    expect(parseWav(new Uint8Array(100))).toBeNull();
  });

  it('긴 곡만 표본율을 낮춘다', () => {
    const MB = 1024 * 1024;
    expect(decodeRate(48000, 120, 120 * MB)).toBe(48000);
    const r = decodeRate(48000, 640, 120 * MB);
    expect(r).toBeLessThan(48000);
    expect(r).toBeGreaterThanOrEqual(22050);
    expect(640 * r * 8).toBeLessThanOrEqual(120 * MB + 640 * 8);
    expect(decodeRate(48000, 6000, 120 * MB)).toBe(22050);
  });
});
