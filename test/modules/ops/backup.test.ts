import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { GENESIS_HASH } from '../../../src/core/hashchain';
import { finalizeDocument } from '../../../src/core/numbering';
import { setDriveRootFolder } from '../../../src/modules/expenses/service';
import type { Notifier } from '../../../src/modules/ita/notify';
import type { DriveBackupUploader } from '../../../src/modules/ops/drive-backup';
import { all } from '../../../src/core/db';
import { restoreAndVerify, runBackup } from '../../../src/modules/ops';
import { OWNER_ACTOR, db, makeDraft, makeSeries } from '../../helpers';

class RecordingUploader implements DriveBackupUploader {
  calls: { rootFolderId: string; path: string[]; filename: string; contentType: string }[] = [];
  async upload(rootFolderId: string, path: string[], filename: string, _bytes: Uint8Array, contentType: string) {
    this.calls.push({ rootFolderId, path, filename, contentType });
  }
}

class RecordingNotifier implements Notifier {
  sent: string[] = [];
  async send(text: string) {
    this.sent.push(text);
    return true;
  }
}

describe('runBackup (runs/R14-ops.md: D1 export to R2, then an in-memory restore test, no scratch database)', () => {
  it('exports every core table, writes a complete manifest, and passes its own restore test', async () => {
    const s = await makeSeries();
    await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });
    await finalizeDocument(db(), await makeDraft({ seriesId: s, payments: [{ amountMinor: 5000, currency: 'USD' }] }), { actor: OWNER_ACTOR });

    const result = await runBackup(env, 'manual', '2026-10-06T03:00:00.000Z');

    expect(result.restoreOk).toBe(true);
    expect(result.restoreError).toBeNull();
    expect(result.documentCount).toBeGreaterThanOrEqual(2);

    const dataObj = await env.BACKUPS.get(result.dataKey);
    const manifestObj = await env.BACKUPS.get(result.manifestKey);
    expect(dataObj).not.toBeNull();
    expect(manifestObj).not.toBeNull();

    const data = JSON.parse(await dataObj!.text()) as Record<string, unknown[]>;
    const manifest = JSON.parse(await manifestObj!.text()) as { tables: Record<string, number>; documentCount: number; chainHeadHash: string };

    // Manifest completeness: every exported table's row count matches the table's own length,
    // and the tables the hash chain needs are all present.
    for (const table of ['documents', 'document_lines', 'payments', 'finalizations', 'clients', 'series']) {
      expect(manifest.tables[table]).toBe(data[table]!.length);
    }
    expect(manifest.documentCount).toBe(result.documentCount);
    expect(manifest.chainHeadHash).toBe(result.chainHeadHash);
    expect(result.chainHeadHash).not.toBe(GENESIS_HASH);

    const backupRow = await db()
      .prepare('SELECT * FROM backups WHERE d1_export_key = ?')
      .bind(result.dataKey)
      .first<{ restore_ok: number; document_count: number }>();
    expect(backupRow?.restore_ok).toBe(1);
    expect(backupRow?.document_count).toBe(result.documentCount);
  });

  it('rejects a restore whose recomputed hash does not match what was exported', async () => {
    await expect(
      restoreAndVerify(
        {
          documents: [
            {
              id: 1, type: 'PR', series_id: 'X', number: 1, legal_mode: 'patur', client_id: null, date: '2026-10-01',
              issuance_date: '2026-10-01', due_date: null, currency: 'ILS', fx_rate: null, fx_rate_date: null, fx_source: null,
              subtotal_minor: 100, vat_rate_bp: null, vat_amount_minor: 0, total_minor: 100, total_ils_minor: 100,
              allocation_number: null, lang_variant: 'en', notes: null, hash: 'f'.repeat(64), prev_hash: GENESIS_HASH,
              finalized_at: '2026-10-01T00:00:00.000Z', status: 'final',
            },
          ],
          document_lines: [],
          payments: [],
          finalizations: [
            { seq: 1, document_id: 1, series_id: 'X', number: 1, prev_hash: GENESIS_HASH, hash: 'f'.repeat(64), finalized_at: '2026-10-01T00:00:00.000Z' },
          ],
        },
        'f'.repeat(64),
      ),
    ).rejects.toThrow(/break/);
  });

  it('sends a Slack alert and records the failure when the injected restore check fails', async () => {
    const notifier = new RecordingNotifier();
    const result = await runBackup(env, 'manual', '2026-10-06T05:00:00.000Z', notifier, async () => {
      throw new Error('scratch database unreachable');
    });

    expect(result.restoreOk).toBe(false);
    expect(result.restoreError).toBe('scratch database unreachable');
    // Also carries the off-site Drive copy's own alert: GOOGLE_SERVICE_ACCOUNT_JSON is not set
    // in the test environment (test/modules/ops/drive-backup.test.ts covers that path directly).
    expect(notifier.sent).toHaveLength(2);
    expect(notifier.sent[0]).toMatch(/restore test failed/);

    const rows = await all<{ restore_ok: number; restore_error: string }>(env.DB, 'SELECT restore_ok, restore_error FROM backups WHERE d1_export_key = ?', result.dataKey);
    expect(rows[0]?.restore_ok).toBe(0);
    expect(rows[0]?.restore_error).toBe('scratch database unreachable');
  });

  it('exports the optional tables (expenses, suppliers) without assuming they exist', async () => {
    // They are already shipped by the time R14 runs, but the export still checks sqlite_master
    // first, so an earlier deploy of just this run would not fail on a table that is not there yet.
    const result = await runBackup(env, 'manual', '2026-10-06T04:00:00.000Z');
    expect(result.restoreOk).toBe(true);
  });

  it('recomputes allocation_records hashes too, and rejects a tampered one', async () => {
    const documentHash = 'a'.repeat(64);
    const allocationNumber = '123456789012345678901234567';
    await expect(
      restoreAndVerify(
        {
          documents: [{ id: 1, hash: documentHash, allocation_number: allocationNumber }],
          document_lines: [],
          payments: [],
          finalizations: [],
          allocation_records: [{ id: 1, document_id: 1, document_hash: documentHash, allocation_number: allocationNumber, hash: 'f'.repeat(64) }],
        },
        GENESIS_HASH,
      ),
    ).rejects.toThrow(/break/);
  });

  it('never writes to a database: the scratch D1 kept only for tests (vitest.config.ts) stays untouched', async () => {
    const s = await makeSeries();
    await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });
    await runBackup(env, 'manual', '2026-10-06T06:00:00.000Z');

    const tables = await env.SCRATCH_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    expect(tables.results).toHaveLength(0);
  });
});

/** R16 task 12: off-site copy of the quarterly backup to Google Drive. Never fails the R2 backup. */
describe('runBackup: off-site Google Drive copy', () => {
  it('warns and alerts Slack, but still succeeds, when GOOGLE_SERVICE_ACCOUNT_JSON is not set', async () => {
    const notifier = new RecordingNotifier();
    const testEnv = { ...env, GOOGLE_SERVICE_ACCOUNT_JSON: undefined };
    const result = await runBackup(testEnv, 'manual', '2026-10-06T07:00:00.000Z', notifier);

    expect(result.restoreOk).toBe(true);
    expect(result.driveUploaded).toBe(false);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatch(/GOOGLE_SERVICE_ACCOUNT_JSON is not set/);
  });

  it('warns and alerts Slack, but still succeeds, when the Drive root folder is not set', async () => {
    const notifier = new RecordingNotifier();
    const testEnv = { ...env, GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"x","private_key":"y"}' };
    const result = await runBackup(testEnv, 'manual', '2026-10-06T07:05:00.000Z', notifier);

    expect(result.restoreOk).toBe(true);
    expect(result.driveUploaded).toBe(false);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatch(/Drive root folder is not set/);
  });

  it('uploads the same export and manifest to "<root>/Backups/YYYY-Qn" once configured', async () => {
    await setDriveRootFolder(env.DB, 'root-folder-id', OWNER_ACTOR);
    const uploader = new RecordingUploader();
    const testEnv = { ...env, GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"x","private_key":"y"}' };
    const result = await runBackup(testEnv, 'quarterly', '2026-10-06T07:10:00.000Z', undefined, undefined, uploader);

    expect(result.driveUploaded).toBe(true);
    expect(uploader.calls).toHaveLength(2);
    for (const call of uploader.calls) {
      expect(call.rootFolderId).toBe('root-folder-id');
      expect(call.path).toEqual(['Backups', '2026-Q4']);
      expect(call.contentType).toBe('application/json');
    }
    expect(uploader.calls.map((c) => c.filename).sort()).toEqual(
      [result.dataKey.split('/').pop(), result.manifestKey.split('/').pop()].sort(),
    );
  });

  it('warns and alerts Slack, but still succeeds, when the Drive upload itself fails', async () => {
    await setDriveRootFolder(env.DB, 'root-folder-id', OWNER_ACTOR);
    const notifier = new RecordingNotifier();
    const failingUploader: DriveBackupUploader = {
      async upload() {
        throw new Error('Google Drive is unreachable');
      },
    };
    const testEnv = { ...env, GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"x","private_key":"y"}' };
    const result = await runBackup(testEnv, 'manual', '2026-10-06T07:15:00.000Z', notifier, undefined, failingUploader);

    expect(result.restoreOk).toBe(true);
    expect(result.driveUploaded).toBe(false);
    expect(notifier.sent.some((s) => s.includes('Google Drive is unreachable'))).toBe(true);
  });
});
