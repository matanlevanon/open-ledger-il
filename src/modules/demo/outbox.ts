import { all, run } from '../../core/db';
import type { Env } from '../../env';
import type { Mailer, OutboundEmail, SentEmail } from '../sending/mailer';
import { ResendMailer } from '../sending/mailer';
import { isDemo } from './config';

/**
 * R26: in demo mode no email reaches a document or contract recipient. This mailer keeps the
 * email in demo_outbox for its business, and Send shows it as a preview: "In your own Ledger this
 * email goes to the client." The gate's own emails (confirmation, codes) use gateMailer instead.
 */
export class DemoOutboxMailer implements Mailer {
  constructor(
    private readonly db: D1Database,
    private readonly businessId: number,
  ) {}

  async send(email: OutboundEmail): Promise<SentEmail> {
    const res = await run(
      this.db,
      'INSERT INTO demo_outbox (business_id, to_addr, subject, html, text) VALUES (?, ?, ?, ?, ?)',
      this.businessId,
      [email.to, ...(email.cc ?? [])].join(', '),
      email.subject,
      email.html,
      email.text,
    );
    return { id: `demo-${res.lastRowId}` };
  }
}

/** The mailer a module uses for client email: the outbox in demo mode, else null to fall through. */
export function demoMailerFor(env: Env): Mailer | null {
  return isDemo(env) ? new DemoOutboxMailer(env.DB, Number(env.DEMO_BUSINESS_ID ?? 0)) : null;
}

/** The gate's own emails: Resend with MAIL_FROM. Null without MAIL_API_KEY. */
export function gateMailer(env: Env): Mailer | null {
  if (!env.MAIL_API_KEY) return null;
  return env.MAIL_FROM ? new ResendMailer(env.MAIL_API_KEY, env.MAIL_FROM) : new ResendMailer(env.MAIL_API_KEY);
}

export async function latestOutbox(db: D1Database, businessIds: number[], limit = 1) {
  if (businessIds.length === 0) return [];
  return all<{ id: number; business_id: number; to_addr: string; subject: string; html: string; text: string; created_at: string }>(
    db,
    `SELECT * FROM demo_outbox WHERE business_id IN (${businessIds.map(() => '?').join(',')}) ORDER BY id DESC LIMIT ?`,
    ...businessIds,
    limit,
  );
}
