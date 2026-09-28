import * as forgeModule from 'node-forge';

// node-forge attaches its submodules (asn1, pki, pkcs7, ...) to a shared object as a side
// effect of requiring them; that only shows up in a CJS default import, not a namespace one,
// once bundled. Unwrap `default` when the bundler nests it there, keeping the namespace's types.
const forge = (forgeModule as unknown as { default?: typeof forgeModule }).default ?? forgeModule;

/**
 * Detached CMS (PKCS#7) SignedData, the container PAdES-B calls for. "Detached" means the
 * encapsulated content is absent; only its SHA-256 digest travels inside a signed attribute,
 * so the PDF byte ranges outside `/Contents` are the actual signed content.
 *
 * node-forge builds the ASN.1 tree (it has no Workers-safe alternative for DER), but every
 * cryptographic operation - both SHA-256 digests and the RSA signature itself - runs through
 * `crypto.subtle`, which is the only implementation available inside a Worker's V8 isolate.
 * node-forge's own `pkcs7.sign()` does both in one synchronous call, so this file rebuilds the
 * same CMS shape by hand instead of calling it, threading the async Web Crypto calls through.
 */

// @types/node-forge lags the library: fromDer's real second argument accepts an options
// object (parseAllBytes: false lets it stop at the CMS blob's own DER length, ignoring the
// zero-byte padding reserved in the PDF's /Contents placeholder), and a signingTime
// attribute's `value` may be a Date, not just a string.
type Asn1FromDer = (bytes: forgeModule.Bytes, options?: { parseAllBytes?: boolean }) => forgeModule.asn1.Asn1;
const fromDerLenient = forge.asn1.fromDer as unknown as Asn1FromDer;

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_DATA = forge.pki.oids.data!;
const OID_SHA256 = forge.pki.oids.sha256!;
const OID_CONTENT_TYPE = forge.pki.oids.contentType!;
const OID_MESSAGE_DIGEST = forge.pki.oids.messageDigest!;
const OID_SIGNING_TIME = forge.pki.oids.signingTime!;
const OID_RSA_ENCRYPTION = forge.pki.oids.rsaEncryption!;
const OID_RSASSA_PSS = forge.pki.oids['RSASSA-PSS']!;
const OID_MGF1 = forge.pki.oids.mgf1!;

/** Salt length in bytes for RSA-PSS signatures, matching the SHA-256 digest this CMS always uses. */
const PSS_SALT_LENGTH = 32;

type RsaScheme = 'RSASSA-PKCS1-v1_5' | 'RSA-PSS';

const { Class: Asn1Class, Type: Asn1Type } = forge.asn1;

function asn1Sequence(value: forgeModule.asn1.Asn1[]): forgeModule.asn1.Asn1 {
  return forge.asn1.create(Asn1Class.UNIVERSAL, Asn1Type.SEQUENCE, true, value);
}

function asn1Set(value: forgeModule.asn1.Asn1[]): forgeModule.asn1.Asn1 {
  return forge.asn1.create(Asn1Class.UNIVERSAL, Asn1Type.SET, true, value);
}

function asn1Oid(oid: string): forgeModule.asn1.Asn1 {
  return forge.asn1.create(Asn1Class.UNIVERSAL, Asn1Type.OID, false, forge.asn1.oidToDer(oid).getBytes());
}

function asn1Null(): forgeModule.asn1.Asn1 {
  return forge.asn1.create(Asn1Class.UNIVERSAL, Asn1Type.NULL, false, '');
}

/** [n] EXPLICIT wrapping, per RFC 4055's RSASSA-PSS-params fields. */
function asn1Explicit(tag: number, inner: forgeModule.asn1.Asn1): forgeModule.asn1.Asn1 {
  return forge.asn1.create(Asn1Class.CONTEXT_SPECIFIC, tag, true, [inner]);
}

function algorithmIdentifier(oid: string, parameters?: forgeModule.asn1.Asn1): forgeModule.asn1.Asn1 {
  return asn1Sequence(parameters ? [asn1Oid(oid), parameters] : [asn1Oid(oid)]);
}

function sha256AlgorithmIdentifier(): forgeModule.asn1.Asn1 {
  return algorithmIdentifier(OID_SHA256, asn1Null());
}

/** RSASSA-PSS-params, fixed to SHA-256 / MGF1-SHA256 / a salt as long as the digest (RFC 4055 §3.1). */
function pssParameters(): forgeModule.asn1.Asn1 {
  const saltLength = forge.asn1.create(
    Asn1Class.UNIVERSAL,
    Asn1Type.INTEGER,
    false,
    forge.asn1.integerToDer(PSS_SALT_LENGTH).getBytes(),
  );
  return asn1Sequence([
    asn1Explicit(0, sha256AlgorithmIdentifier()),
    asn1Explicit(1, algorithmIdentifier(OID_MGF1, sha256AlgorithmIdentifier())),
    asn1Explicit(2, saltLength),
  ]);
}

function signatureAlgorithmIdentifier(scheme: RsaScheme): forgeModule.asn1.Asn1 {
  return scheme === 'RSA-PSS'
    ? algorithmIdentifier(OID_RSASSA_PSS, pssParameters())
    : algorithmIdentifier(OID_RSA_ENCRYPTION, asn1Null());
}

/** Reads the scheme a SignerInfo's digestEncryptionAlgorithm declares. Unrecognized OIDs fall back to PKCS#1 v1.5. */
function schemeFromAlgorithmIdentifier(node: forgeModule.asn1.Asn1): RsaScheme {
  const oid = forge.asn1.derToOid((node.value as forgeModule.asn1.Asn1[])[0]!.value as string);
  return oid === OID_RSASSA_PSS ? 'RSA-PSS' : 'RSASSA-PKCS1-v1_5';
}

function signAlgorithmParams(scheme: RsaScheme): SubtleCryptoSignAlgorithm {
  return scheme === 'RSA-PSS' ? { name: 'RSA-PSS', saltLength: PSS_SALT_LENGTH } : { name: 'RSASSA-PKCS1-v1_5' };
}

/** A SEQUENCE { AttributeType, SET { AttributeValue } }, per RFC 2315 Attribute. */
function attributeAsn1(typeOid: string, valueNode: forgeModule.asn1.Asn1): forgeModule.asn1.Asn1 {
  return asn1Sequence([asn1Oid(typeOid), asn1Set([valueNode])]);
}

function signingTimeValueAsn1(signedAt: Date): forgeModule.asn1.Asn1 {
  // Per RFC 2985: UTCTime for 1950-2049 inclusive, GeneralizedTime outside that range.
  const utcTimeEra = signedAt >= new Date('1950-01-01T00:00:00Z') && signedAt < new Date('2050-01-01T00:00:00Z');
  return utcTimeEra
    ? forge.asn1.create(Asn1Class.UNIVERSAL, Asn1Type.UTCTIME, false, forge.asn1.dateToUtcTime(signedAt))
    : forge.asn1.create(Asn1Class.UNIVERSAL, Asn1Type.GENERALIZEDTIME, false, forge.asn1.dateToGeneralizedTime(signedAt));
}

/** The three PKCS#9 signed attributes CMS requires: content type, message digest, signing time. */
function authenticatedAttributes(messageDigest: Uint8Array, signedAt: Date): forgeModule.asn1.Asn1[] {
  return [
    attributeAsn1(OID_CONTENT_TYPE, asn1Oid(OID_DATA)),
    attributeAsn1(
      OID_MESSAGE_DIGEST,
      forge.asn1.create(Asn1Class.UNIVERSAL, Asn1Type.OCTETSTRING, false, forge.util.binary.raw.encode(messageDigest)),
    ),
    attributeAsn1(OID_SIGNING_TIME, signingTimeValueAsn1(signedAt)),
  ];
}

interface ImportedSigningKey {
  cryptoKey: CryptoKey;
  scheme: RsaScheme;
}

/**
 * Imports an RSA private key PEM for `crypto.subtle.sign`, and reads which signature scheme it
 * declares. A PKCS#1 "RSA PRIVATE KEY" carries no algorithm identifier at all, so it always
 * means PKCS#1 v1.5; a PKCS#8 "PRIVATE KEY" names its scheme explicitly (rsaEncryption or
 * id-RSASSA-PSS), which this reads directly off the DER rather than assuming.
 */
async function importSigningKey(keyPem: string): Promise<ImportedSigningKey> {
  const pem = forge.pem.decode(keyPem)[0];
  if (!pem) throw new Error('importSigningKey: not a PEM-encoded key.');

  let pkcs8Der: Uint8Array;
  let scheme: RsaScheme;

  if (pem.type === 'PRIVATE KEY') {
    const privateKeyInfo = forge.asn1.fromDer(pem.body);
    const algorithmNode = (privateKeyInfo.value as forgeModule.asn1.Asn1[])[1]!;
    scheme = schemeFromAlgorithmIdentifier(algorithmNode);
    pkcs8Der = forge.util.binary.raw.decode(pem.body);
  } else if (pem.type === 'RSA PRIVATE KEY') {
    scheme = 'RSASSA-PKCS1-v1_5';
    const rsaPrivateKey = forge.pki.privateKeyFromPem(keyPem);
    const privateKeyInfo = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(rsaPrivateKey));
    pkcs8Der = forge.util.binary.raw.decode(forge.asn1.toDer(privateKeyInfo).getBytes());
  } else {
    throw new Error(`importSigningKey: unsupported PEM header "${pem.type}".`);
  }

  const cryptoKey = await crypto.subtle.importKey('pkcs8', pkcs8Der, { name: scheme, hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return { cryptoKey, scheme };
}

export interface CmsSignInput {
  /** The bytes the signature covers (the PDF's two byte ranges, concatenated). */
  content: Uint8Array;
  keyPem: string;
  certPem: string;
  signedAt: Date;
}

/** Builds a detached, SHA-256 CMS SignedData over `content`, signed with an RSA key. */
export async function buildDetachedCms(input: CmsSignInput): Promise<Uint8Array> {
  const certificate = forge.pki.certificateFromPem(input.certPem);
  const { cryptoKey, scheme } = await importSigningKey(input.keyPem);

  const messageDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', input.content));
  const attributesForSigning = authenticatedAttributes(messageDigest, input.signedAt);

  // Per RFC 2315 9.3: signed attributes are digested (and signed) as a SET OF, not the [0]
  // IMPLICIT form they are transmitted in.
  const attributeSetDer = forge.asn1.toDer(asn1Set(attributesForSigning)).getBytes();
  const signature = new Uint8Array(
    await crypto.subtle.sign(signAlgorithmParams(scheme), cryptoKey, forge.util.binary.raw.decode(attributeSetDer)),
  );

  const signerInfo = asn1Sequence([
    forge.asn1.create(Asn1Class.UNIVERSAL, Asn1Type.INTEGER, false, forge.asn1.integerToDer(1).getBytes()),
    asn1Sequence([
      forge.pki.distinguishedNameToAsn1({ attributes: certificate.issuer.attributes }),
      forge.asn1.create(Asn1Class.UNIVERSAL, Asn1Type.INTEGER, false, forge.util.hexToBytes(certificate.serialNumber)),
    ]),
    sha256AlgorithmIdentifier(),
    // [0] IMPLICIT authenticatedAttributes, built fresh so this SET's nodes aren't shared with
    // the one just DER-encoded above for digesting.
    forge.asn1.create(
      Asn1Class.CONTEXT_SPECIFIC,
      0,
      true,
      authenticatedAttributes(messageDigest, input.signedAt),
    ),
    signatureAlgorithmIdentifier(scheme),
    forge.asn1.create(Asn1Class.UNIVERSAL, Asn1Type.OCTETSTRING, false, forge.util.binary.raw.encode(signature)),
  ]);

  const encapContentInfo = asn1Sequence([asn1Oid(OID_DATA)]); // detached: no [0] EXPLICIT content

  const signedData = forge.asn1.create(Asn1Class.CONTEXT_SPECIFIC, 0, true, [
    asn1Sequence([
      forge.asn1.create(Asn1Class.UNIVERSAL, Asn1Type.INTEGER, false, forge.asn1.integerToDer(1).getBytes()),
      asn1Set([sha256AlgorithmIdentifier()]),
      encapContentInfo,
      forge.asn1.create(Asn1Class.CONTEXT_SPECIFIC, 0, true, [forge.pki.certificateToAsn1(certificate)]),
      asn1Set([signerInfo]),
    ]),
  ]);

  const contentInfo = asn1Sequence([asn1Oid(OID_SIGNED_DATA), signedData]);
  return forge.util.binary.raw.decode(forge.asn1.toDer(contentInfo).getBytes());
}

export interface CmsVerifyResult {
  ok: boolean;
  reason?: string;
  signerCommonName?: string;
  signedAt?: Date;
}

function attributeValueNode(attribute: forgeModule.asn1.Asn1): forgeModule.asn1.Asn1 {
  const parts = attribute.value as forgeModule.asn1.Asn1[];
  const values = parts[1]!;
  return (values.value as forgeModule.asn1.Asn1[])[0]!;
}

/**
 * Verifies a detached CMS SignedData against the bytes it claims to sign. Walks the ASN.1
 * tree directly (node-forge's own `pkcs7.verify` is unimplemented) rather than trusting any
 * length past the structure's own DER length, since the PDF `/Contents` hex string is padded
 * with trailing zero bytes to a fixed reserved size.
 */
export async function verifyDetachedCms(der: Uint8Array, content: Uint8Array): Promise<CmsVerifyResult> {
  let contentInfo: forgeModule.asn1.Asn1;
  try {
    contentInfo = fromDerLenient(forge.util.binary.raw.encode(der), { parseAllBytes: false });
  } catch {
    return { ok: false, reason: 'not_der' };
  }

  const top = contentInfo.value as forgeModule.asn1.Asn1[];
  if (top.length < 2 || forge.asn1.derToOid(top[0]!.value as string) !== OID_SIGNED_DATA) {
    return { ok: false, reason: 'not_signed_data' };
  }
  const signedData = (top[1]!.value as forgeModule.asn1.Asn1[])[0]!;
  const parts = signedData.value as forgeModule.asn1.Asn1[];

  const encapContentInfo = parts[2]!;
  const encapParts = encapContentInfo.value as forgeModule.asn1.Asn1[];
  if (forge.asn1.derToOid(encapParts[0]!.value as string) !== OID_DATA) {
    return { ok: false, reason: 'unsupported_content_type' };
  }
  if (encapParts.length > 1) return { ok: false, reason: 'not_detached' };

  let index = 3;
  let certificatesNode: forgeModule.asn1.Asn1 | undefined;
  const candidate = parts[index];
  if (candidate && candidate.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && candidate.type === 0) {
    certificatesNode = candidate;
    index += 1;
  }
  if (!certificatesNode || (certificatesNode.value as forgeModule.asn1.Asn1[]).length !== 1) {
    return { ok: false, reason: 'missing_certificate' };
  }

  const signerInfos = parts[index];
  const signerInfoList = signerInfos ? (signerInfos.value as forgeModule.asn1.Asn1[]) : [];
  if (signerInfoList.length !== 1) return { ok: false, reason: 'unexpected_signer_count' };
  const signerInfo = signerInfoList[0]!.value as forgeModule.asn1.Asn1[];

  const digestAlgorithmOid = forge.asn1.derToOid((signerInfo[2]!.value as forgeModule.asn1.Asn1[])[0]!.value as string);
  if (digestAlgorithmOid !== OID_SHA256) return { ok: false, reason: 'unsupported_digest_algorithm' };

  const authAttrsNode = signerInfo[3];
  if (!authAttrsNode || authAttrsNode.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || authAttrsNode.type !== 0) {
    return { ok: false, reason: 'missing_signed_attributes' };
  }
  const signatureAlgorithmNode = signerInfo[4];
  if (!signatureAlgorithmNode) return { ok: false, reason: 'missing_signature_algorithm' };
  const scheme = schemeFromAlgorithmIdentifier(signatureAlgorithmNode);

  const signatureNode = signerInfo[5];
  if (!signatureNode) return { ok: false, reason: 'missing_signature' };
  const signature = signatureNode.value as string;

  const attributes = authAttrsNode.value as forgeModule.asn1.Asn1[];
  let contentTypeAttr: string | undefined;
  let messageDigest: string | undefined;
  let signedAt: Date | undefined;
  for (const attribute of attributes) {
    const parts2 = attribute.value as forgeModule.asn1.Asn1[];
    const oid = forge.asn1.derToOid(parts2[0]!.value as string);
    const valueNode = attributeValueNode(attribute);
    if (oid === OID_CONTENT_TYPE) contentTypeAttr = forge.asn1.derToOid(valueNode.value as string);
    else if (oid === OID_MESSAGE_DIGEST) messageDigest = valueNode.value as string;
    else if (oid === OID_SIGNING_TIME) {
      signedAt =
        valueNode.type === forge.asn1.Type.UTCTIME
          ? forge.asn1.utcTimeToDate(valueNode.value as string)
          : forge.asn1.generalizedTimeToDate(valueNode.value as string);
    }
  }
  if (contentTypeAttr !== OID_DATA) return { ok: false, reason: 'bad_content_type_attribute' };
  if (messageDigest === undefined) return { ok: false, reason: 'missing_message_digest' };

  const contentDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', content));
  if (forge.util.binary.raw.encode(contentDigest) !== messageDigest) {
    return { ok: false, reason: 'digest_mismatch' };
  }

  const attributeSet = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attributes);
  const attributeSetDer = forge.util.binary.raw.decode(forge.asn1.toDer(attributeSet).getBytes());

  const certificate = forge.pki.certificateFromAsn1((certificatesNode.value as forgeModule.asn1.Asn1[])[0]!);
  const spkiDer = forge.util.binary.raw.decode(forge.asn1.toDer(forge.pki.publicKeyToAsn1(certificate.publicKey)).getBytes());
  const publicKey = await crypto.subtle.importKey('spki', spkiDer, { name: scheme, hash: 'SHA-256' }, false, [
    'verify',
  ]);
  const signatureValid = await crypto.subtle.verify(
    signAlgorithmParams(scheme),
    publicKey,
    forge.util.binary.raw.decode(signature),
    attributeSetDer,
  );
  if (!signatureValid) return { ok: false, reason: 'bad_signature' };

  const cn = certificate.subject.getField('CN');
  return { ok: true, signerCommonName: cn ? cn.value : undefined, signedAt };
}

/** Reads the signer's display name and validity window from a PEM certificate. Never logs the key. */
export function certificateInfo(certPem: string): { commonName?: string; notBefore: Date; notAfter: Date } {
  const cert = forge.pki.certificateFromPem(certPem);
  const cn = cert.subject.getField('CN');
  return { commonName: cn ? cn.value : undefined, notBefore: cert.validity.notBefore, notAfter: cert.validity.notAfter };
}
