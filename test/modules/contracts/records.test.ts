import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';

/**
 * R28 task 1: the 2800 migration. Contract origin, the client reminder switch, reminder_log, and the
 * rebuilt contracts triggers: an external contract is signed from insert and never changes, and
 * every Ledger rule still holds.
 */

async function sqlError(sql: string, ...params: (string | number | null)[]) {
  try {
    await env.DB.prepare(sql).bind(...params).run();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

let clientId = 0;
let ledgerTemplate = 0;
let externalTemplate = 0;

const EXTERNAL_INSERT = `INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title, status, origin, signed_at, signed_pdf_r2_key, signed_pdf_sha256, signer_name, signer_email)
  VALUES (1, ?, ?, 1, 'contract', 'Signed elsewhere', 'signed', 'external', '2026-09-01T00:00:00Z', 'business/1/contracts/abc.pdf', 'abc', 'Dana', 'dana@acme.example')`;

beforeAll(async () => {
  await run(env.DB, "INSERT INTO clients (name_en, business_id) VALUES ('R28 Trigger Client', 1)");
  clientId = (await first<{ id: number }>(env.DB, "SELECT id FROM clients WHERE name_en = 'R28 Trigger Client'"))!.id;
  await run(env.DB, "INSERT INTO contract_templates (business_id, name, kind) VALUES (1, 'R28 Ledger', 'contract')");
  ledgerTemplate = (await first<{ id: number }>(env.DB, "SELECT id FROM contract_templates WHERE name = 'R28 Ledger'"))!.id;
  await run(env.DB, "INSERT INTO contract_templates (business_id, name, kind, origin, active) VALUES (1, 'R28 External', 'contract', 'external', 0)");
  externalTemplate = (await first<{ id: number }>(env.DB, "SELECT id FROM contract_templates WHERE name = 'R28 External'"))!.id;
});

describe('R28 migration 2800', () => {
  it('existing rows default to origin ledger, clients to automatic reminders on and no default payment methods', async () => {
    const c = (await first<{ auto_reminders: number; default_payment_method_ids: string | null }>(env.DB, 'SELECT auto_reminders, default_payment_method_ids FROM clients WHERE id = ?', clientId))!;
    expect(c.default_payment_method_ids).toBeNull();
    expect(c.auto_reminders).toBe(1);
    await run(env.DB, "INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title) VALUES (1, ?, ?, 1, 'contract', 'Draft')", clientId, ledgerTemplate);
    const row = (await first<{ origin: string; status: string }>(env.DB, "SELECT origin, status FROM contracts WHERE title = 'Draft'"))!;
    expect(row).toEqual({ origin: 'ledger', status: 'draft' });
  });

  it('a Ledger contract still starts as a draft, never signed, and never on an external template', async () => {
    expect(await sqlError("INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title, status) VALUES (1, ?, ?, 1, 'contract', 'x', 'signed')", clientId, ledgerTemplate)).toContain('contract_fixed');
    expect(await sqlError("INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title) VALUES (1, ?, ?, 1, 'contract', 'x')", clientId, externalTemplate)).toContain('contract_fixed');
  });

  it('an external contract is inserted signed with its PDF and hash, on an external template only', async () => {
    expect(await sqlError(EXTERNAL_INSERT, clientId, externalTemplate)).toBeNull();
    expect(await sqlError(EXTERNAL_INSERT, clientId, ledgerTemplate)).toContain('contract_fixed');
    expect(
      await sqlError("INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title, status, origin) VALUES (1, ?, ?, 1, 'contract', 'x', 'draft', 'external')", clientId, externalTemplate),
    ).toContain('contract_fixed');
    expect(
      await sqlError(
        "INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title, status, origin, signed_at) VALUES (1, ?, ?, 1, 'contract', 'x', 'signed', 'external', '2026-09-01')",
        clientId,
        externalTemplate,
      ),
    ).toContain('contract_fixed');
  });

  it('an external contract never changes, and void keeps it on record', async () => {
    const id = (await first<{ id: number }>(env.DB, "SELECT id FROM contracts WHERE origin = 'external' LIMIT 1"))!.id;
    expect(await sqlError("UPDATE contracts SET signed_pdf_sha256 = 'x' WHERE id = ?", id)).toContain('contract_fixed');
    expect(await sqlError("UPDATE contracts SET title = 'x' WHERE id = ?", id)).toContain('contract_fixed');
    expect(await sqlError("UPDATE contracts SET field_values_json = '{\"a\":1}' WHERE id = ?", id)).toContain('contract_fixed');
    expect(await sqlError("UPDATE contracts SET signer_name = 'x' WHERE id = ?", id)).toContain('contract_fixed');
    expect(await sqlError("UPDATE contracts SET origin = 'ledger' WHERE id = ?", id)).toContain('contract_fixed');
    expect(await sqlError("UPDATE contracts SET status = 'declined' WHERE id = ?", id)).toContain('contract_fixed');
    expect(await sqlError("UPDATE contracts SET status = 'void' WHERE id = ?", id)).toContain('contract_fixed');
    expect(await sqlError('DELETE FROM contracts WHERE id = ?', id)).toContain('append_only');
    expect(await sqlError("UPDATE contracts SET status = 'void', void_at = '2026-10-13T00:00:00Z' WHERE id = ?", id)).toBeNull();
    expect(await sqlError("UPDATE contracts SET status = 'signed', void_at = NULL WHERE id = ?", id)).toContain('contract_fixed');
    expect((await first<{ status: string }>(env.DB, 'SELECT status FROM contracts WHERE id = ?', id))!.status).toBe('void');
  });

  it('a template origin never changes', async () => {
    expect(await sqlError("UPDATE contract_templates SET origin = 'ledger' WHERE id = ?", externalTemplate)).toContain('contract_fixed');
  });

  it('reminder_log is append only and scoped to the client business', async () => {
    const insert = "INSERT INTO reminder_log (business_id, client_id, target_kind, target_id, channel, rule, result) VALUES (?, ?, 'contract', 1, 'email', 'unsigned_3', 'sent')";
    expect(await sqlError(insert, 1, clientId)).toBeNull();
    await run(env.DB, "INSERT INTO businesses (id, name_en) VALUES (28, 'Other')");
    expect(await sqlError(insert, 28, clientId)).toContain('business_mismatch');
    expect(await sqlError("UPDATE reminder_log SET result = 'failed'")).toContain('append_only');
    expect(await sqlError('DELETE FROM reminder_log')).toContain('append_only');
    expect(await sqlError("INSERT INTO reminder_log (business_id, client_id, target_kind, target_id, channel, rule, result) VALUES (1, ?, 'invoice', 1, 'email', 'x', 'sent')", clientId)).not.toBeNull();
  });
});
