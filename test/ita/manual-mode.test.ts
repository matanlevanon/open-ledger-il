import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { AuditActor } from '../../src/core/audit';
import { first } from '../../src/core/db';
import { itaManualMode } from '../../src/modules/ita/config';
import { runRetryQueue } from '../../src/modules/ita/jobs';
import { itaEnv, setupIta } from './helpers';

const OWNER: AuditActor = { userId: null, email: 'owner@example.com', role: 'owner', ip: '127.0.0.1', userAgent: 'vitest' };
const HOUR = 60 * 60_000;
const NO_APP = { ITA_CLIENT_ID_SANDBOX: undefined, ITA_CLIENT_SECRET_SANDBOX: undefined };

describe('manual mode: no ITA API app', () => {
  it('is on only when the current environment has no client id or secret', () => {
    expect(itaManualMode(itaEnv())).toBe(false);
    expect(itaManualMode(itaEnv(NO_APP))).toBe(true);
    expect(itaManualMode(itaEnv({ ITA_CLIENT_SECRET_SANDBOX: undefined }))).toBe(true);
  });

  it('queues the invoice for the web app without calling the ITA', async () => {
    const { service, addInvoice, docs, mock } = await setupIta({ envOverrides: NO_APP, connect: false });
    const doc = await addInvoice();
    const result = await service.request(doc.id, OWNER);
    expect(result).toMatchObject({ status: 'pending', outcome: 'manual_required', confirmation_number: null });
    expect(mock.calls).toHaveLength(0);
    expect(docs.docs.get(doc.id)!.status).toBe('allocation_pending');
    const row = await first<{ last_error_code: string; deadline_at: string | null }>(
      env.DB,
      'SELECT last_error_code, deadline_at FROM ita_allocations WHERE document_id = ?',
      doc.id,
    );
    expect(row).toMatchObject({ last_error_code: 'manual_mode' });
    expect(row!.deadline_at).not.toBeNull();
  });

  it('a number typed in from the web app finalizes the document', async () => {
    const { service, addInvoice, docs } = await setupIta({ envOverrides: NO_APP, connect: false });
    const doc = await addInvoice();
    await service.request(doc.id, OWNER);
    const result = await service.enterManual(doc.id, '123456789', 'From the ITA web app', OWNER);
    expect(result.status).toBe('approved');
    expect(docs.docs.get(doc.id)!.status).toBe('final');
  });

  it('the queue job never calls the ITA and sends one reminder after 24 hours', async () => {
    const { service, addInvoice, mock, notifier, clock, env: ienv, deps } = await setupIta({ envOverrides: NO_APP, connect: false });
    const doc = await addInvoice();
    await service.request(doc.id, OWNER);
    await runRetryQueue(ienv, deps);
    expect(mock.calls).toHaveLength(0);
    expect(notifier.messages).toHaveLength(0);
    clock.advance(25 * HOUR);
    const run = await runRetryQueue(ienv, deps);
    expect(run).toMatchObject({ retried: 0, stalled: 1, alerts: 1 });
    expect(notifier.messages[0]).toContain(`document ${doc.id} has no ITA allocation number after 24 hours.`);
    expect(mock.calls).toHaveLength(0);
    await runRetryQueue(ienv, deps);
    expect(notifier.messages).toHaveLength(1);
  });
});
