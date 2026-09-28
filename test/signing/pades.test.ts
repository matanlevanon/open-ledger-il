import { PDFDocument } from 'pdf-lib';
import * as forgeModule from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';
import { signPdf, verifyPdf } from '../../src/modules/signing';

// See src/modules/signing/cms.ts for why the namespace import needs unwrapping.
const forge = (forgeModule as unknown as { default?: typeof forgeModule }).default ?? forgeModule;

let identity: { keyPem: string; certPem: string };

function makeTestIdentity(): { keyPem: string; certPem: string } {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const subject = [{ name: 'commonName', value: 'Sample Business Ltd' }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { keyPem: forge.pki.privateKeyToPem(keys.privateKey), certPem: forge.pki.certificateToPem(cert) };
}

async function makeBasePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawText('Open Ledger IL test document', { x: 10, y: 100, size: 12 });
  return doc.save();
}

const SIGNED_AT = new Date('2026-10-01T09:30:00Z');

/** One char code per byte, for exact-offset text search over PDF bytes. Mirrors pades.ts's own decode. */
function latin1Decode(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return out;
}

/**
 * Verifies a signed PDF using nothing from src/modules/signing: only node-forge for ASN.1 and
 * `crypto.subtle` for the actual cryptography. A round trip through our own signPdf/verifyPdf
 * would pass even if both shared the same bug; this walks the PDF and the CMS structure fresh,
 * the way an outside verifier would, to confirm the RSA signature crypto.subtle produced is
 * independently checkable.
 */
async function independentlyVerify(signed: Uint8Array): Promise<boolean> {
  const text = latin1Decode(signed);

  const byteRangeMatch = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
  if (!byteRangeMatch) return false;
  const [, r1StartStr, r1LenStr, r2StartStr, r2LenStr] = byteRangeMatch;
  const r1Start = Number(r1StartStr);
  const r1Len = Number(r1LenStr);
  const r2Start = Number(r2StartStr);
  const r2Len = Number(r2LenStr);

  const contentsTagMatch = /\/Contents\s*</.exec(text);
  if (!contentsTagMatch) return false;
  const contentsOpenAngle = contentsTagMatch.index + contentsTagMatch[0].length - 1;
  const contentsCloseAngle = text.indexOf('>', contentsOpenAngle + 1);
  const contentsHex = text.slice(contentsOpenAngle + 1, contentsCloseAngle).replace(/[^0-9A-Fa-f]/g, '');
  const cmsDer = new Uint8Array(contentsHex.length / 2);
  for (let i = 0; i < cmsDer.length; i++) cmsDer[i] = Number.parseInt(contentsHex.slice(i * 2, i * 2 + 2), 16);

  const signedContent = new Uint8Array(r1Len + r2Len);
  signedContent.set(signed.subarray(r1Start, r1Start + r1Len), 0);
  signedContent.set(signed.subarray(r2Start, r2Start + r2Len), r1Len);

  // Parse just enough of the CMS SignedData to reach the certificate, the signed attributes,
  // and the RSA signature. `parseAllBytes: false` stops at the structure's own DER length,
  // since /Contents is zero-padded to a fixed reserved size.
  const fromDer = forge.asn1.fromDer as unknown as (
    bytes: string,
    options?: { parseAllBytes?: boolean },
  ) => forgeModule.asn1.Asn1;
  const contentInfo = fromDer(forge.util.binary.raw.encode(cmsDer), { parseAllBytes: false });
  const signedData = ((contentInfo.value as forgeModule.asn1.Asn1[])[1]!.value as forgeModule.asn1.Asn1[])[0]!;
  const parts = signedData.value as forgeModule.asn1.Asn1[];
  const certificateAsn1 = (parts[3]!.value as forgeModule.asn1.Asn1[])[0]!;
  const signerInfo = (parts[4]!.value as forgeModule.asn1.Asn1[])[0]!.value as forgeModule.asn1.Asn1[];

  const authAttrsNode = signerInfo[3]!;
  const attributes = authAttrsNode.value as forgeModule.asn1.Asn1[];
  const messageDigestAttr = attributes.find(
    (attr) => forge.asn1.derToOid((attr.value as forgeModule.asn1.Asn1[])[0]!.value as string) === forge.pki.oids.messageDigest,
  )!;
  const messageDigest = (
    ((messageDigestAttr.value as forgeModule.asn1.Asn1[])[1]!.value as forgeModule.asn1.Asn1[])[0]!.value as string
  );
  const signature = signerInfo[5]!.value as string;

  const expectedDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', signedContent));
  if (forge.util.binary.raw.encode(expectedDigest) !== messageDigest) return false;

  const attributeSetDer = forge.util.binary.raw.decode(
    forge.asn1.toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attributes)).getBytes(),
  );

  const certificate = forge.pki.certificateFromAsn1(certificateAsn1);
  const spkiDer = forge.util.binary.raw.decode(forge.asn1.toDer(forge.pki.publicKeyToAsn1(certificate.publicKey)).getBytes());
  const publicKey = await crypto.subtle.importKey('spki', spkiDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'verify',
  ]);
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    forge.util.binary.raw.decode(signature),
    attributeSetDer,
  );
}

describe('PDF signing (PAdES-B, detached CMS)', () => {
  beforeAll(() => {
    identity = makeTestIdentity();
  });

  it('signs a PDF and verifies it', async () => {
    const pdf = await makeBasePdf();
    const signed = await signPdf(pdf, { ...identity, signedAt: SIGNED_AT });

    expect(signed.length).toBeGreaterThan(pdf.length);
    const result = await verifyPdf(signed);
    expect(result.valid).toBe(true);
    expect(result.signerCommonName).toBe('Sample Business Ltd');
    // UTCTime has one-second precision.
    expect(result.signedAt?.getTime()).toBe(SIGNED_AT.getTime());
  });

  it('fails verification when a signed byte changes after signing', async () => {
    const pdf = await makeBasePdf();
    const signed = await signPdf(pdf, { ...identity, signedAt: SIGNED_AT });

    const tampered = signed.slice();
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;

    const result = await verifyPdf(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('digest_mismatch');
  });

  it('rejects a PDF with no signature', async () => {
    const pdf = await makeBasePdf();
    expect((await verifyPdf(pdf)).valid).toBe(false);
  });

  it('produces a signature an independent ASN.1 + crypto.subtle verifier confirms end to end', async () => {
    const pdf = await makeBasePdf();
    const signed = await signPdf(pdf, { ...identity, signedAt: SIGNED_AT });
    expect(await independentlyVerify(signed)).toBe(true);

    const tampered = signed.slice();
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(await independentlyVerify(tampered)).toBe(false);
  });

  it('is deterministic for a fixed signing time, and changes only with it', async () => {
    const pdf = await makeBasePdf();
    const signedA = await signPdf(pdf, { ...identity, signedAt: SIGNED_AT });
    const signedB = await signPdf(pdf, { ...identity, signedAt: SIGNED_AT });
    expect(signedA).toEqual(signedB);

    const signedLater = await signPdf(pdf, { ...identity, signedAt: new Date(SIGNED_AT.getTime() + 1000) });
    expect(signedLater).not.toEqual(signedA);
  });
});
