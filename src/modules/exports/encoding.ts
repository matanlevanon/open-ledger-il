/**
 * Windows-1255 (Hebrew) encode/decode. The Worker runtime has no built-in support for this
 * code page (only UTF-8), and the unified-file spec (runs/R13-exports.md) calls for Windows-1255
 * or whatever encoding the ITA spec PDF requires once it is in specs/unified-file/. This is a
 * fixed, publicly documented single-byte code page, not an ITA-specific guess: bytes 0x00-0x7F
 * match ASCII, 0xE0-0xFA carry א-ת in order, and 0xA4 is the new shekel sign.
 *
 * Only the characters Open Ledger IL actually needs are mapped: ASCII, the Hebrew alphabet, the
 * shekel sign, and common Latin-1 punctuation. Anything else encodes as '?' (0x3F) rather than
 * throwing, since a business name or note should never block an export; `encodeWindows1255`
 * reports whether it had to substitute.
 */

const HIGH_BYTE_TO_CODEPOINT: Record<number, number> = {
  0x80: 0x20ac, // €
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8b: 0x2039,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9b: 0x203a,
  0xa0: 0x00a0,
  0xa1: 0x00a1,
  0xa2: 0x00a2,
  0xa3: 0x00a3,
  0xa4: 0x20aa, // ₪ new shekel sign
  0xa5: 0x00a5,
  0xa6: 0x00a6,
  0xa7: 0x00a7,
  0xa8: 0x00a8,
  0xa9: 0x00a9,
  0xaa: 0x00d7,
  0xab: 0x00ab,
  0xac: 0x00ac,
  0xad: 0x00ad,
  0xae: 0x00ae,
  0xaf: 0x00af,
  0xb0: 0x00b0,
  0xb1: 0x00b1,
  0xb2: 0x00b2,
  0xb3: 0x00b3,
  0xb4: 0x00b4,
  0xb5: 0x00b5,
  0xb6: 0x00b6,
  0xb7: 0x00b7,
  0xb8: 0x00b8,
  0xb9: 0x00b9,
  0xba: 0x00f7,
  0xbb: 0x00bb,
  0xbc: 0x00bc,
  0xbd: 0x00bd,
  0xbe: 0x00be,
  0xbf: 0x00bf,
  0xfd: 0x200f, // RLM
  0xfe: 0x200e, // LRM
};

// Hebrew block: 0xE0 alef (U+05D0) through 0xFA tav (U+05EA), consecutive code points both sides.
for (let i = 0; i <= 0x1a; i++) {
  HIGH_BYTE_TO_CODEPOINT[0xe0 + i] = 0x05d0 + i;
}

const CODEPOINT_TO_HIGH_BYTE = new Map<number, number>(
  Object.entries(HIGH_BYTE_TO_CODEPOINT).map(([byte, codepoint]) => [codepoint, Number(byte)]),
);

const REPLACEMENT_BYTE = 0x3f; // '?'

export interface EncodeResult {
  bytes: Uint8Array;
  /** True when at least one character had no Windows-1255 byte and was replaced with '?'. */
  lossy: boolean;
}

export function encodeWindows1255(text: string): EncodeResult {
  const bytes = new Uint8Array(text.length);
  let lossy = false;
  for (let i = 0; i < text.length; i++) {
    const codepoint = text.codePointAt(i)!;
    if (codepoint <= 0x7f) {
      bytes[i] = codepoint;
    } else {
      const byte = CODEPOINT_TO_HIGH_BYTE.get(codepoint);
      if (byte === undefined) {
        bytes[i] = REPLACEMENT_BYTE;
        lossy = true;
      } else {
        bytes[i] = byte;
      }
    }
  }
  return { bytes, lossy };
}

export function decodeWindows1255(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += String.fromCodePoint(byte <= 0x7f ? byte : (HIGH_BYTE_TO_CODEPOINT[byte] ?? REPLACEMENT_BYTE));
  }
  return out;
}

/**
 * ISO-8859-8 (logical Hebrew), the character set the unified file instructions require on
 * Windows (section 2.4 ח, INI field 1029 = 1). ASCII and the Hebrew letters share their bytes
 * with Windows-1255. Anything else is written as '?' and reported.
 */
export function encodeIso88598(text: string): EncodeResult {
  const bytes = new Uint8Array(text.length);
  let lossy = false;
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp <= 0x7f) bytes[i] = cp;
    else if (cp >= 0x05d0 && cp <= 0x05ea) bytes[i] = 0xe0 + (cp - 0x05d0);
    else if (cp === 0x00a0) bytes[i] = 0x20;
    else if (cp === 0x05f3 || cp === 0x2018 || cp === 0x2019) bytes[i] = 0x27; // geresh and curly quotes to '
    else if (cp === 0x05f4 || cp === 0x201c || cp === 0x201d) bytes[i] = 0x22; // gershayim and curly quotes to "
    else if (cp === 0x2013 || cp === 0x2014) bytes[i] = 0x2d; // dashes to -
    else if (cp === 0x200e) bytes[i] = 0xfd;
    else if (cp === 0x200f) bytes[i] = 0xfe;
    else if (cp === 0x00d7) bytes[i] = 0xaa;
    else if (cp === 0x00f7) bytes[i] = 0xba;
    else {
      bytes[i] = REPLACEMENT_BYTE;
      lossy = true;
    }
  }
  return { bytes, lossy };
}

export function decodeIso88598(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    if (b <= 0x7f) out += String.fromCharCode(b);
    else if (b >= 0xe0 && b <= 0xfa) out += String.fromCharCode(0x05d0 + (b - 0xe0));
    else if (b === 0xfd) out += '‎';
    else if (b === 0xfe) out += '‏';
    else if (b === 0xaa) out += '×';
    else if (b === 0xba) out += '÷';
    else out += '?';
  }
  return out;
}
