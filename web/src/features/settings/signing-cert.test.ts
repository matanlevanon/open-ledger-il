import forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import { makeSigningPair } from './signing-cert';

/** R48 task 3: the browser makes the key and the certificate, as the installer's signingCert does. */
describe('makeSigningPair', () => {
  it('makes RSA 3072, a PKCS#8 key, and a 10-year certificate naming the business and its tax id', async () => {
    const now = new Date('2026-11-12T00:00:00Z');
    const { keyPem, certPem } = await makeSigningPair('עסק לקוח בע"מ', '514-000-082', now);
    expect(keyPem).toContain('BEGIN PRIVATE KEY');
    const cert = forge.pki.certificateFromPem(certPem);
    const pub = cert.publicKey as forge.pki.rsa.PublicKey;
    expect(pub.n.bitLength()).toBe(3072);
    expect(forge.util.decodeUtf8(String(cert.subject.getField('CN').value))).toBe('עסק לקוח בע"מ');
    expect(forge.util.decodeUtf8(String(cert.subject.getField('O').value))).toBe('עסק לקוח בע"מ');
    expect(cert.subject.getField('C').value).toBe('IL');
    expect(cert.subject.getField({ name: 'serialNumber' }).value).toBe('514000082');
    expect(cert.validity.notAfter.getUTCFullYear()).toBe(2036);
    expect(Number.parseInt(cert.serialNumber[0]!, 16)).toBeLessThan(8);
    const key = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
    expect(key.n.toString(16)).toBe(pub.n.toString(16));
  }, 60_000);
});
