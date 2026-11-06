/**
 * WAV(PCM 8/16/24/32비트 정수·32/64비트 실수) 직접 읽기.
 * 브라우저 decodeAudioData는 긴 곡을 원래 표본율로 다 푼 뒤 줄여서 중간 메모리가 크다 —
 * 10분 wav(122MB)에서 탭 메모리가 1GB를 넘겨 태블릿에서 꺼졌다 (AWC2026 ofnr).
 * 여기서는 원본 바이트를 복사하지 않고 읽으며 목표 표본율로 바로 옮겨 쓴다.
 */
export interface WavInfo {
  channels: number;
  rate: number;
  bits: number;
  float: boolean;
  dataOffset: number;
  frames: number;
}

export function parseWav(u8: Uint8Array): WavInfo | null {
  if (u8.length < 44) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o: number) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let o = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (o + 8 <= u8.length) {
    const id = tag(o);
    let size = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ' && size >= 16) {
      let format = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      const rate = dv.getUint32(body + 4, true);
      const bits = dv.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: 실제 형식은 하위 형식 GUID 앞 2바이트
      if (format === 0xfffe && size >= 26) format = dv.getUint16(body + 24, true);
      fmt = { format, channels, rate, bits };
    } else if (id === 'data' && fmt) {
      // 크기가 0이거나 파일보다 크게 적힌 파일(스트리밍으로 쓴 wav)은 파일 끝까지
      if (size === 0 || body + size > u8.length) size = u8.length - body;
      const bytes = fmt.bits / 8;
      const isFloat = fmt.format === 3;
      const okInt = fmt.format === 1 && [8, 16, 24, 32].includes(fmt.bits);
      const okFloat = isFloat && (fmt.bits === 32 || fmt.bits === 64);
      if (!(okInt || okFloat) || fmt.channels < 1 || fmt.channels > 8 || fmt.rate < 1000) return null;
      return { channels: fmt.channels, rate: fmt.rate, bits: fmt.bits, float: isFloat, dataOffset: body, frames: Math.floor(size / (bytes * fmt.channels)) };
    }
    o = body + size + (size & 1);
  }
  return null;
}

/**
 * WAV 표본을 목표 표본율로 옮겨 채널별 배열에 쓴다 (줄일 때는 구간 평균으로 거칠게 고역을 걸러 앨리어싱을 줄인다).
 * out[c]의 길이 = 출력 프레임 수.
 */
export function wavToChannels(u8: Uint8Array, info: WavInfo, out: Float32Array[]): void {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const bytes = info.bits / 8;
  const stride = bytes * info.channels;
  const read = (frame: number, ch: number): number => {
    const p = info.dataOffset + frame * stride + ch * bytes;
    if (info.float) return info.bits === 32 ? dv.getFloat32(p, true) : dv.getFloat64(p, true);
    switch (info.bits) {
      case 8:
        return (u8[p] - 128) / 128;
      case 16:
        return dv.getInt16(p, true) / 32768;
      case 24: {
        const v = u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16);
        return (v & 0x800000 ? v - 0x1000000 : v) / 8388608;
      }
      default:
        return dv.getInt32(p, true) / 2147483648;
    }
  };
  const n = out[0]?.length ?? 0;
  if (!n || !info.frames) return;
  // 16비트 정수는 복사 없는 Int16Array로 빠르게 (짝수 위치일 때)
  const abs = u8.byteOffset + info.dataOffset;
  if (!info.float && info.bits === 16 && abs % 2 === 0) {
    const pcm = new Int16Array(u8.buffer, abs, info.frames * info.channels);
    const chs = info.channels;
    const step16 = info.frames / n;
    for (let c = 0; c < out.length; c++) {
      const src = Math.min(c, chs - 1);
      const dst = out[c];
      if (step16 <= 1.0001) {
        for (let i = 0; i < n; i++) {
          const x = i * step16;
          const a = Math.floor(x);
          const f = x - a;
          const s0 = pcm[Math.min(a, info.frames - 1) * chs + src];
          const s1 = pcm[Math.min(a + 1, info.frames - 1) * chs + src];
          dst[i] = (s0 + (s1 - s0) * f) / 32768;
        }
      } else {
        for (let i = 0; i < n; i++) {
          const a = Math.floor(i * step16);
          const b = Math.min(info.frames, Math.max(a + 1, Math.floor((i + 1) * step16)));
          let sum = 0;
          for (let k = a; k < b; k++) sum += pcm[k * chs + src];
          dst[i] = sum / (b - a) / 32768;
        }
      }
    }
    return;
  }
  const step = info.frames / n; // 출력 1프레임당 입력 프레임 수
  for (let c = 0; c < out.length; c++) {
    const src = Math.min(c, info.channels - 1);
    const dst = out[c];
    if (step <= 1.0001) {
      // 늘리거나 같은 표본율: 선형 보간
      for (let i = 0; i < n; i++) {
        const x = i * step;
        const a = Math.floor(x);
        const f = x - a;
        const s0 = read(Math.min(a, info.frames - 1), src);
        const s1 = f > 0 ? read(Math.min(a + 1, info.frames - 1), src) : s0;
        dst[i] = s0 + (s1 - s0) * f;
      }
    } else {
      // 줄이기: 출력 한 칸에 해당하는 입력 구간 평균
      for (let i = 0; i < n; i++) {
        const a = Math.floor(i * step);
        const b = Math.min(info.frames, Math.max(a + 1, Math.floor((i + 1) * step)));
        let sum = 0;
        for (let k = a; k < b; k++) sum += read(k, src);
        dst[i] = sum / (b - a);
      }
    }
  }
}
