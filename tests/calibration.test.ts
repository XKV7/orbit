import { describe, expect, it } from 'vitest';
import { offsetFor, type DeviceProfile } from '../src/audio/device';
import { steadyMean } from '../src/core/offset';

const prof = (lat: number, offset: number, at: number): DeviceProfile => ({ lat, offset, grade: 'A', at });

describe('device offset', () => {
  it('uses the same-kind profile even when reported latency drifts', () => {
    const list = [prof(20, 60, 1)];
    expect(offsetFor(list, 20)).toBe(60);
    expect(offsetFor(list, 55)).toBe(60); // 예전엔 지연이 바뀌면 보정을 못 찾아 0
  });
  it('keeps bluetooth and wired apart, newest wins', () => {
    const list = [prof(20, 60, 1), prof(250, 280, 2), prof(30, 70, 3)];
    expect(offsetFor(list, 25)).toBe(70);
    expect(offsetFor(list, 240)).toBe(280);
  });
  it('estimates from the other kind by latency difference', () => {
    expect(offsetFor([prof(20, 60, 1)], 220)).toBe(260);
  });
  it('falls back to reported latency when never calibrated', () => {
    expect(offsetFor([], 40)).toBe(40);
  });
});

describe('steadyMean', () => {
  it('ignores outlier taps', () => {
    expect(steadyMean([50, 52, 48, 51, 49, 50, 200])).toBeCloseTo(50, 0);
  });
});
