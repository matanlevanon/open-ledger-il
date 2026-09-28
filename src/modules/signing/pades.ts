import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { buildDetachedCms, verifyDetachedCms } from './cms';

/**
 * PAdES-B: a detached CMS signature (see `cms.ts`) embedded in a PDF signature field, per
 * ISO 32000-1 12.8. `signPdf` reserves fixed-width placeholders for `/ByteRange` and
 * `/Contents`, saves once with `pdf-lib`, then patches the exact signature bytes into that
 * already-saved buffer. It never re-serializes with `pdf-lib` after that: any further save
 * would renumber offsets and invalidate `/ByteRange`.
 */

export interface SigningIdentity {
  keyPem: string;
  certPem: string;
}

export interface SignPdfOptions extends SigningIdentity {
  /** Defaults to now. Pass a fixed value for reproducible output in tests. */
  signedAt?: Date;
  reason?: string;
  location?: string;
  /** Field name in the AcroForm. Defaults to "Signature1". */
  fieldName?: string;
  /** The /Name entry, the business name from Settings > Business. */
  signerName?: string;
}

export interface VerifyPdfResult {
  valid: boolean;
  reason?: string;
  signerCommonName?: string;
  signedAt?: Date;
}

/** Bytes reserved for the CMS blob (cert + RSA-3072 signature + overhead), well above what it needs. */
const CONTENTS_PLACEHOLDER_BYTES = 8192;
/** Fixed decimal width for the three variable /ByteRange numbers, so patching never shifts bytes. */
const BYTE_RANGE_DIGITS = 10;
const BYTE_RANGE_PLACEHOLDER = '9'.repeat(BYTE_RANGE_DIGITS);
const DEFAULT_SIGNER_NAME = 'Open Ledger IL';

const HEX_DIGITS = '0123456789abcdef';

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += HEX_DIGITS[b >> 4]! + HEX_DIGITS[b & 0x0f]!;
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `${hex}0`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Decodes bytes 1:1 into a string (one char code per byte), for exact-offset text search. */
function latin1Decode(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return out;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export async function signPdf(bytes: Uint8Array, options: SignPdfOptions): Promise<Uint8Array> {
  const signedAt = options.signedAt ?? new Date();
  const fieldName = options.fieldName ?? 'Signature1';

  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const { context } = doc;
  const page = doc.getPage(0);

  const byteRange = PDFArray.withContext(context);
  byteRange.push(PDFNumber.of(0));
  byteRange.push(PDFNumber.of(Number(BYTE_RANGE_PLACEHOLDER)));
  byteRange.push(PDFNumber.of(Number(BYTE_RANGE_PLACEHOLDER)));
  byteRange.push(PDFNumber.of(Number(BYTE_RANGE_PLACEHOLDER)));

  const sigDict = PDFDict.withContext(context);
  sigDict.set(PDFName.of('Type'), PDFName.of('Sig'));
  sigDict.set(PDFName.of('Filter'), PDFName.of('Adobe.PPKLite'));
  sigDict.set(PDFName.of('SubFilter'), PDFName.of('ETSI.CAdES.detached'));
  sigDict.set(PDFName.of('ByteRange'), byteRange);
  sigDict.set(PDFName.of('Contents'), PDFHexString.of('0'.repeat(CONTENTS_PLACEHOLDER_BYTES * 2)));
  sigDict.set(PDFName.of('M'), PDFString.fromDate(signedAt));
  sigDict.set(PDFName.of('Name'), PDFString.of(options.signerName ?? DEFAULT_SIGNER_NAME));
  if (options.reason) sigDict.set(PDFName.of('Reason'), PDFString.of(options.reason));
  if (options.location) sigDict.set(PDFName.of('Location'), PDFString.of(options.location));
  const sigRef = context.register(sigDict);

  const widget = PDFDict.withContext(context);
  widget.set(PDFName.of('Type'), PDFName.of('Annot'));
  widget.set(PDFName.of('Subtype'), PDFName.of('Widget'));
  widget.set(PDFName.of('FT'), PDFName.of('Sig'));
  widget.set(PDFName.of('Rect'), context.obj([0, 0, 0, 0]));
  widget.set(PDFName.of('V'), sigRef);
  widget.set(PDFName.of('T'), PDFString.of(fieldName));
  widget.set(PDFName.of('P'), page.ref);
  widget.set(PDFName.of('F'), PDFNumber.of(132)); // Print + Locked; invisible regardless, via the zero Rect
  const widgetRef = context.register(widget);

  page.node.addAnnot(widgetRef);
  const acroForm = doc.catalog.getOrCreateAcroForm();
  acroForm.addField(widgetRef);
  acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3)); // SignaturesExist | AppendOnly

  // Object streams would bury the placeholders inside compressed data, where the byte search
  // below could never find them.
  const withPlaceholders = await doc.save({ useObjectStreams: false });

  const contentsNeedle = new TextEncoder().encode(`<${'0'.repeat(CONTENTS_PLACEHOLDER_BYTES * 2)}>`);
  const contentsMarkerStart = indexOfBytes(withPlaceholders, contentsNeedle);
  if (contentsMarkerStart === -1) throw new Error('signPdf: could not find the /Contents placeholder.');
  const contentsOpenAngle = contentsMarkerStart;
  const contentsCloseAngle = contentsMarkerStart + contentsNeedle.length - 1;

  const byteRangeText = `[ 0 ${BYTE_RANGE_PLACEHOLDER} ${BYTE_RANGE_PLACEHOLDER} ${BYTE_RANGE_PLACEHOLDER} ]`;
  const byteRangeStart = indexOfBytes(withPlaceholders, new TextEncoder().encode(byteRangeText));
  if (byteRangeStart === -1) throw new Error('signPdf: could not find the /ByteRange placeholder.');

  // Range 1 covers byte 0 through the '<' that opens /Contents; range 2 covers the closing
  // '>' through end of file. Together they are every byte except the hex digits themselves.
  const range1Length = contentsOpenAngle + 1;
  const range2Start = contentsCloseAngle;
  const range2Length = withPlaceholders.length - contentsCloseAngle;

  const pad = (n: number): string => {
    const s = String(n);
    if (s.length > BYTE_RANGE_DIGITS) throw new Error('signPdf: document too large for the reserved /ByteRange width.');
    return s.padStart(BYTE_RANGE_DIGITS, '0');
  };
  const patchedByteRangeText = `[ 0 ${pad(range1Length)} ${pad(range2Start)} ${pad(range2Length)} ]`;

  const output = withPlaceholders.slice();
  output.set(new TextEncoder().encode(patchedByteRangeText), byteRangeStart);

  const signedContent = new Uint8Array(range1Length + range2Length);
  signedContent.set(output.subarray(0, range1Length), 0);
  signedContent.set(output.subarray(range2Start, range2Start + range2Length), range1Length);

  const cms = await buildDetachedCms({ content: signedContent, keyPem: options.keyPem, certPem: options.certPem, signedAt });
  if (cms.length > CONTENTS_PLACEHOLDER_BYTES) {
    throw new Error('signPdf: the signature is larger than the reserved /Contents space.');
  }
  const signatureHex = bytesToHex(cms).padEnd(CONTENTS_PLACEHOLDER_BYTES * 2, '0');
  output.set(new TextEncoder().encode(signatureHex), contentsOpenAngle + 1);

  return output;
}

export async function verifyPdf(bytes: Uint8Array): Promise<VerifyPdfResult> {
  const text = latin1Decode(bytes);

  const byteRangeMatch = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
  if (!byteRangeMatch) return { valid: false, reason: 'missing_byte_range' };
  const r1Start = Number(byteRangeMatch[1]);
  const r1Len = Number(byteRangeMatch[2]);
  const r2Start = Number(byteRangeMatch[3]);
  const r2Len = Number(byteRangeMatch[4]);
  if (r1Start !== 0) return { valid: false, reason: 'byte_range_does_not_start_at_zero' };
  if (r2Start + r2Len !== bytes.length) return { valid: false, reason: 'signature_does_not_cover_end_of_file' };

  const contentsTagMatch = /\/Contents\s*</.exec(text);
  if (!contentsTagMatch) return { valid: false, reason: 'missing_contents' };
  const contentsOpenAngle = contentsTagMatch.index + contentsTagMatch[0].length - 1;
  const contentsCloseAngle = text.indexOf('>', contentsOpenAngle + 1);
  if (contentsCloseAngle === -1) return { valid: false, reason: 'malformed_contents' };

  // The /ByteRange values must bracket this exact /Contents value; otherwise either one
  // could have been edited independently of the other after signing.
  if (r1Len !== contentsOpenAngle + 1 || r2Start !== contentsCloseAngle) {
    return { valid: false, reason: 'byte_range_mismatch' };
  }

  const contentsHex = text.slice(contentsOpenAngle + 1, contentsCloseAngle).replace(/[^0-9A-Fa-f]/g, '');

  const signedContent = new Uint8Array(r1Len + r2Len);
  signedContent.set(bytes.subarray(r1Start, r1Start + r1Len), 0);
  signedContent.set(bytes.subarray(r2Start, r2Start + r2Len), r1Len);

  const result = await verifyDetachedCms(hexToBytes(contentsHex), signedContent);
  if (!result.ok) return { valid: false, reason: result.reason };
  return { valid: true, signerCommonName: result.signerCommonName, signedAt: result.signedAt };
}
