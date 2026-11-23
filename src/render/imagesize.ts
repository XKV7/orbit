/**
 * 그림 파일 머리말에서 가로·세로만 읽는다 (해독하지 않고). 미리 불러오기 전에 레벨 그림 전체 크기를 알아
 * 그래픽 메모리 예산 안에서 얼마나 크게 올릴지 정하는 데 쓴다. 모르는 형식이면 null.
 */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const n = b.length;
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const u32le = (i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + ((b[i + 3] << 24) >>> 0);
  const ok = (w: number, h: number) => (w > 0 && h > 0 ? { w, h } : null);
  // PNG: 8바이트 서명 + IHDR
  if (n >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ok(u32be(16), u32be(20));
  // GIF
  if (n >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(u16le(6), u16le(8));
  // BMP (세로가 음수면 위→아래)
  if (n >= 26 && b[0] === 0x42 && b[1] === 0x4d) return ok(Math.abs(u32le(18) | 0), Math.abs(u32le(22) | 0));
  // WebP (RIFF....WEBP)
  if (n >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8X') return ok(u24le(24) + 1, u24le(27) + 1);
    if (kind === 'VP8 ') return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
    if (kind === 'VP8L') {
      const v = u32le(21);
      return ok((v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1);
    }
    return null;
  }
  // JPEG: SOFn 마커를 찾는다
  if (n >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < n) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      // 길이 없는 마커
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      if (m === 0xd9 || m === 0xda) return null;
      // SOF0~SOF15 (DHT c4·JPG c8·DAC cc 제외)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(u16be(i + 7), u16be(i + 5));
      i += 2 + u16be(i + 2);
    }
  }
  return null;
}
