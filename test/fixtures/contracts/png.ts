/** R25 test fixture: a small valid RGB PNG built in code (stored deflate, no compression library). */

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typed = concat(new TextEncoder().encode(type), data);
  return concat(u32(data.length), typed, u32(crc32(typed)));
}

/** A width x height PNG with a diagonal stroke pattern. Shade changes the bytes, so hashes differ. */
export function testPng(width = 40, height = 16, shade = 20): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const v = (x + y) % 7 === 0 ? shade : 250;
      raw.set([v, v, v], y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  const stored = concat(new Uint8Array([0x78, 0x01, 0x01, raw.length & 255, raw.length >>> 8, ~raw.length & 255, (~raw.length >>> 8) & 255]), raw, u32(adler32(raw)));
  const ihdr = concat(u32(width), u32(height), new Uint8Array([8, 2, 0, 0, 0]));
  return concat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', stored), chunk('IEND', new Uint8Array()));
}

export function pngDataUri(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(s)}`;
}
