#!/usr/bin/env node
// Creates a self-managed RSA-3072 key and self-signed certificate for your business, for the
// PDF signature in src/modules/signing (R03): a self-managed key, no certification authority.
// Usage: node scripts/make-signing-cert.mjs "Sample Business Ltd". Prints the PEM
// blocks and writes nothing to disk or the repo. Run again to rotate the key before it expires;
// PDFs already signed keep their existing signature.
import forge from 'node-forge';

const BUSINESS_NAME = process.argv[2]?.trim();
if (!BUSINESS_NAME) {
  console.error('Pass your business name: node scripts/make-signing-cert.mjs "Sample Business Ltd"');
  process.exit(1);
}

const SUBJECT = [
  { name: 'commonName', value: BUSINESS_NAME },
  { name: 'organizationName', value: BUSINESS_NAME },
  { name: 'countryName', value: 'IL' },
];
const YEARS_VALID = 10;

function randomSerialHex() {
  // A DER INTEGER is signed; keep the top nibble below 8 so it never reads as negative.
  const hex = forge.util.bytesToHex(forge.random.getBytesSync(16));
  return (Number.parseInt(hex[0], 16) >= 8 ? `0${hex.slice(1)}` : hex);
}

console.log('Generating an RSA-3072 key pair. This can take up to a minute...');
const keys = forge.pki.rsa.generateKeyPair({ bits: 3072 });

const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = randomSerialHex();
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + YEARS_VALID);
cert.setSubject(SUBJECT);
cert.setIssuer(SUBJECT);
cert.setExtensions([
  { name: 'basicConstraints', cA: false },
  { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  { name: 'subjectKeyIdentifier' },
]);
cert.sign(keys.privateKey, forge.md.sha256.create());

const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
const certPem = forge.pki.certificateToPem(cert);

console.log(`
=== SIGNING_KEY_PEM ===

${keyPem}
=== SIGNING_CERT_PEM ===

${certPem}
Nothing above was written to disk. Store each block only in Worker secrets, never in the repo:

  npx wrangler secret put SIGNING_KEY_PEM
  npx wrangler secret put SIGNING_CERT_PEM

Paste the full PEM block, including the BEGIN/END lines, when prompted.

Valid ${YEARS_VALID} years from today (${cert.validity.notBefore.toISOString().slice(0, 10)} to
${cert.validity.notAfter.toISOString().slice(0, 10)}). Run this script again before it expires to
rotate the key; PDFs already signed keep their existing signature and still verify.
`);
