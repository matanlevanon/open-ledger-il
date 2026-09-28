import * as forgeModule from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import type { PdfEngine } from '../../../src/modules/pdf';

// See src/modules/signing/cms.ts for why the namespace import needs unwrapping.
const forge = (forgeModule as unknown as { default?: typeof forgeModule }).default ?? forgeModule;

/** Unlike pdf/engine.ts's FakePdfEngine (raw HTML bytes), this returns a real, signable PDF. */
export class FakeSignablePdfEngine implements PdfEngine {
  async renderPdf(): Promise<ArrayBuffer> {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const bytes = await doc.save();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
}

export interface TestSigningIdentity {
  keyPem: string;
  certPem: string;
}

/** A throwaway RSA key and self-signed certificate, for signPdf in tests. Slow (RSA-2048 keygen); build once per file. */
export function makeTestSigningIdentity(): TestSigningIdentity {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const subject = [{ name: 'commonName', value: 'Sample Business Ltd Test' }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { keyPem: forge.pki.privateKeyToPem(keys.privateKey), certPem: forge.pki.certificateToPem(cert) };
}
