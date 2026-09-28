#!/usr/bin/env node
// Leak guard. Scans the working tree for terms that must never ship in this repository: names,
// ids and domains from the private deployment this code came from. The terms themselves are not
// in the repo. scripts/leak-denylist.txt holds:
//   sha256:<hex>:<length>  the SHA-256 of one lowercased term, and its length in characters
//   fragment:<text>        a non-identifying, case-insensitive substring to refuse outright
// The script hashes candidate strings (words, word pairs and triples, dotted or dashed compound
// tokens, and their prefixes) and compares. Binary files (PDF, PNG, fonts) are checked through
// their printable strings, which covers PDF info and XMP metadata and PNG text chunks.
//
// Usage: node scripts/leak-check.mjs [path ...]   (defaults to the repository root)
// Exit code 1 on any hit. Prints the file, the line and which rule matched, never the term.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DENYLIST = join(ROOT, 'scripts', 'leak-denylist.txt');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.wrangler', 'dist', 'coverage', '.claude']);
const SKIP_FILES = new Set([DENYLIST]);
const BINARY = /\.(pdf|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|zip|gz)$/i;
const MAX_NGRAM = 3;
const HAS_LETTER = /\p{L}/u;

function loadDenylist() {
  const hashes = new Map();
  const fragments = [];
  for (const raw of readFileSync(DENYLIST, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('sha256:')) {
      const [, hex, len] = line.split(':');
      hashes.set(hex.toLowerCase(), Number(len));
    } else if (line.startsWith('fragment:')) {
      fragments.push(line.slice('fragment:'.length).toLowerCase());
    }
  }
  return { hashes, lengths: [...new Set(hashes.values())].sort((a, b) => a - b), fragments };
}

const { hashes, lengths, fragments } = loadDenylist();
const cache = new Map();

function sha(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * True when the candidate, or one of its prefixes with a denylisted length, hashes to a denylisted
 * term. Prefixes count only when they hold a letter (ids such as a folder or account id), so a
 * plain number matches only as a whole number.
 */
function denied(candidate) {
  const hit = cache.get(candidate);
  if (hit !== undefined) return hit;
  let result = hashes.has(sha(candidate));
  if (!result && HAS_LETTER.test(candidate)) {
    const chars = [...candidate];
    for (const len of lengths) {
      if (len >= chars.length) break;
      const prefix = chars.slice(0, len).join('');
      if (HAS_LETTER.test(prefix) && hashes.has(sha(prefix))) {
        result = true;
        break;
      }
    }
  }
  cache.set(candidate, result);
  return result;
}

/** Candidate strings on one line: words, n-grams of words, and compound tokens with . - _ @ kept. */
function candidates(line) {
  const text = line.normalize('NFC').toLowerCase();
  const out = new Set();
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let gram = '';
    for (let n = 0; n < MAX_NGRAM && i + n < words.length; n++) {
      gram = n === 0 ? words[i] : `${gram} ${words[i + n]}`;
      out.add(gram);
    }
  }
  for (const token of text.split(/[^\p{L}\p{N}._@-]+/u)) {
    if (token.length > 1) out.add(token);
    // Each dotted or at-separated part of an email or domain, with its dashes kept.
    for (const part of token.split(/[.@]+/)) if (part.length > 1) out.add(part);
  }
  return out;
}

function checkText(file, text, findings, binary = false) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    for (const fragment of fragments) {
      if (lower.includes(fragment)) findings.push({ file, line: i + 1, rule: `fragment "${fragment}"` });
    }
    for (const candidate of candidates(line)) {
      // Numbers inside binary data are object ids and lengths, not document numbers.
      if (binary && !HAS_LETTER.test(candidate)) continue;
      if (denied(candidate)) {
        findings.push({ file, line: i + 1, rule: `denylisted term (${[...candidate].length} chars)` });
        break;
      }
    }
  }
}

/** Printable ASCII and UTF-8 runs of 4+ characters, like `strings`. */
function printableStrings(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const ascii = text.match(/[\x20-\x7e]{4,}/g) ?? [];
  const utf8 = Buffer.from(bytes).toString('utf8').match(/[\p{L}\p{N}][\p{L}\p{N} ._@-]{3,}/gu) ?? [];
  return [...ascii, ...utf8].join('\n');
}

function walk(path, out) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(join(path, entry), out);
    }
  } else if (!SKIP_FILES.has(path)) {
    out.push(path);
  }
}

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2).map((p) => resolve(p)) : [ROOT];
const files = [];
for (const target of targets) walk(target, files);

const findings = [];
for (const file of files) {
  const bytes = readFileSync(file);
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const binary = BINARY.test(file) || bytes.includes(0);
  checkText(rel, binary ? printableStrings(bytes) : bytes.toString('utf8'), findings, binary);
  // A file name can leak too.
  checkText(`${rel} (file name)`, rel, findings);
}

if (findings.length > 0) {
  for (const f of findings) console.log(`LEAK ${f.file}:${f.line} ${f.rule}`);
  console.log(`\nleak-check: ${findings.length} finding(s) in ${files.length} files.`);
  process.exit(1);
}
console.log(`leak-check: clean. ${files.length} files, ${hashes.size} hashed terms, ${fragments.length} fragments.`);
