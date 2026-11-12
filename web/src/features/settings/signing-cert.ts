/**
 * R48 task 3: a signing key and certificate for one business, made in the browser.
 *
 * The Worker never generates RSA: the free plan gives a request 10 ms of CPU. WebCrypto makes the
 * RSA 3072 key here, node-forge (loaded only when this runs, so the main bundle does not grow)
 * builds the self-signed certificate the same way as scripts/make-signing-cert.mjs: UTF8String subject so a Hebrew name survives, CN and O the
 * business name, C=IL, serialNumber the tax id, 10 years, a positive serial.
 */

export interface SigningPair {
  keyPem: string;
  certPem: string;
}

function toBase64(bytes: ArrayBuffer): string {
  let s = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) s += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(s);
}

function pem(label: string, der: ArrayBuffer): string {
  const body = toBase64(der).replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function randomSerialHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  // A leading digit of 8 or more would read as a negative number in DER.
  return Number.parseInt(hex[0]!, 16) >= 8 ? `0${hex.slice(1)}` : hex;
}

/** Makes a key pair with WebCrypto and a 10-year self-signed certificate for the business. */
export async function makeSigningPair(businessName: string, taxId: string | null, now = new Date()): Promise<SigningPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const keyPem = pem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const certPem = await buildCertificate(keyPem, businessName, taxId, now);
  return { keyPem, certPem };
}

export async function buildCertificate(keyPem: string, businessName: string, taxId: string | null, now = new Date()): Promise<string> {
  const forge = (await import('node-forge')).default;
  const key = forge.pki.privateKeyFromPem(keyPem) as import('node-forge').pki.rsa.PrivateKey;
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  cert.serialNumber = randomSerialHex();
  cert.validity.notBefore = new Date(now);
  cert.validity.notAfter = new Date(now);
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  // UTF8String, so a Hebrew business name survives (forge's default string type mangles it).
  const utf8 = { valueTagClass: forge.asn1.Type.UTF8, value: businessName };
  const fields: Record<string, unknown>[] = [
    { name: 'commonName', ...utf8 },
    { name: 'organizationName', ...utf8 },
    { name: 'countryName', value: 'IL' },
  ];
  const digits = (taxId ?? '').replace(/\D/g, '');
  if (digits) fields.push({ name: 'serialNumber', value: digits });
  const subject = fields as unknown as import('node-forge').pki.CertificateField[];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(key, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

/** Opens a PKCS#12 (.p12 or .pfx) file in the browser. Only the key and certificate leave it. */
export async function readPkcs12(bytes: ArrayBuffer, password: string): Promise<SigningPair> {
  const forge = (await import('node-forge')).default;
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  const asn1 = forge.asn1.fromDer(binary);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag! })[forge.pki.oids.pkcs8ShroudedKeyBag!] ?? [];
  const plainKeys = p12.getBags({ bagType: forge.pki.oids.keyBag! })[forge.pki.oids.keyBag!] ?? [];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag! })[forge.pki.oids.certBag!] ?? [];
  const key = keyBags[0]?.key ?? plainKeys[0]?.key;
  const cert = certBags[0]?.cert;
  if (!key || !cert) throw new Error('The file holds no key and certificate.');
  const keyPem = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key)));
  return { keyPem, certPem: forge.pki.certificateToPem(cert) };
}
