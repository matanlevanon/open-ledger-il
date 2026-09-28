import { zipSync } from 'fflate';
import { all } from '../../core/db';
import type { Env } from '../../env';
import { displayNumber } from '../documents/types';
import { allocationGate } from '../ita/gate';
import { r2Key } from '../pdf/store';

/**
 * R21 "Download documents for a period" (SUMIT's הורדת מסמכים לתקופה): one ZIP of the filed
 * PDFs already stored in R2 for every numbered document dated in the period, plus the original
 * file of every document imported from SUMIT or Wave, under `imported/`.
 *
 * Nothing is rendered here. A document whose PDF was never stored is listed in `manifest.txt`
 * rather than rendered on the fly. Rule 3: a final document passes the allocation gate before
 * its PDF goes in, so a qualifying tax invoice with no allocation number or recorded refusal
 * stays out. A cancelled document is listed, never included, the same as the gate reads it.
 */

export interface DocumentsZipResult {
  bytes: Uint8Array;
  included: number;
  imported: number;
  skipped: { number: string; reason: string }[];
}

function safeName(value: string): string {
  return value.replace(/[^\p{L}\p{N}._ -]/gu, '').trim() || 'file';
}

export async function buildDocumentsZip(env: Env, from: string, to: string): Promise<DocumentsZipResult> {
  const docs = await all<{ id: number; date: string; type: string; series_id: string; number: number; status: string }>(
    env.DB,
    `SELECT id, date, type, series_id, number, status FROM documents
     WHERE number IS NOT NULL AND status IN ('final', 'cancelled') AND date BETWEEN ? AND ?
     ORDER BY date, id`,
    from,
    to,
  );
  const external = await all<{ id: number; source: string; original_number: string; issue_date: string; r2_key: string }>(
    env.DB,
    'SELECT id, source, original_number, issue_date, r2_key FROM external_documents WHERE issue_date BETWEEN ? AND ? ORDER BY issue_date, id',
    from,
    to,
  );

  const files: Record<string, Uint8Array> = {};
  const skipped: DocumentsZipResult['skipped'] = [];
  let included = 0;

  for (const d of docs) {
    const label = displayNumber(d.type, d.number) ?? `${d.series_id}-${d.number}`;
    if (d.status === 'cancelled') {
      skipped.push({ number: label, reason: 'cancelled' });
      continue;
    }
    const gate = await allocationGate(env.DB, d.id);
    if (!gate.allowed) {
      skipped.push({ number: label, reason: `allocation gate: ${gate.reason}` });
      continue;
    }
    const obj = await env.FILES.get(r2Key(d.date, d.series_id, d.number, 'filed'));
    if (!obj) {
      skipped.push({ number: label, reason: 'no stored PDF yet' });
      continue;
    }
    files[`${d.date}_${safeName(label)}.pdf`] = new Uint8Array(await obj.arrayBuffer());
    included += 1;
  }

  let imported = 0;
  for (const x of external) {
    const obj = await env.FILES.get(x.r2_key);
    if (!obj) {
      skipped.push({ number: `${x.source} ${x.original_number}`, reason: 'imported file missing' });
      continue;
    }
    const ext = x.r2_key.includes('.') ? x.r2_key.slice(x.r2_key.lastIndexOf('.')) : '.pdf';
    files[`imported/${x.issue_date}_${x.source}_${safeName(x.original_number)}${ext}`] = new Uint8Array(await obj.arrayBuffer());
    imported += 1;
  }

  const manifest = [
    `Open Ledger IL documents, ${from} to ${to}`,
    `Filed PDFs included: ${included}`,
    `Imported originals included: ${imported}`,
    `Not included: ${skipped.length}`,
    ...skipped.map((s) => `  ${s.number}: ${s.reason}`),
    '',
  ].join('\r\n');
  files['manifest.txt'] = new TextEncoder().encode(manifest);

  return { bytes: zipSync(files, { level: 6 }), included, imported, skipped };
}
