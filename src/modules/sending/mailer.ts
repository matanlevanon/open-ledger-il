/** Outgoing email. `ResendMailer` is the real implementation, `FakeMailer` collects sends in tests. */

export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

export interface OutboundEmail {
  to: string;
  /** Copies. Omitted from the provider call when empty. */
  cc?: string[];
  /** Blind copies. Omitted from the provider call when empty. */
  bcc?: string[];
  subject: string;
  /** R24: the display name in From, the brand or business. The address stays the configured sender. */
  fromName?: string;
  /** R48: the business's own email, so a reply reaches the business and not the Ledger's sender. */
  replyTo?: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface SentEmail {
  id: string | null;
}

export interface Mailer {
  send(email: OutboundEmail): Promise<SentEmail>;
}


/**
 * R48: the Reply-To of every email a business sends, its own email when set. The From address
 * stays the Ledger's sender with the business's name.
 */
export async function businessReplyTo(db: D1Database, businessId: number): Promise<string | undefined> {
  const row = await db.prepare('SELECT email FROM businesses WHERE id = ?').bind(businessId).first<{ email: string | null }>();
  const email = row?.email?.trim();
  return email && email.includes('@') ? email : undefined;
}

/** "Name <address>" with the name replaced, quotes and angle brackets dropped from the new name. */
export function withDisplayName(from: string, name: string): string {
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from.trim();
  const clean = name.replace(/["<>]/g, '').trim();
  return clean ? `${clean} <${address}>` : from;
}

function base64(bytes: Uint8Array): string {
  let str = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) str += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(str);
}

/** Resend (https://resend.com), the outgoing email provider named in docs/secrets.md (MAIL_API_KEY). */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    /** The MAIL_FROM variable, for example "Sample Business Ltd <billing@example.com>". */
    private readonly from: string = '',
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async send(email: OutboundEmail): Promise<SentEmail> {
    const res = await this.fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: email.fromName ? withDisplayName(this.from, email.fromName) : this.from,
        to: [email.to],
        ...(email.cc && email.cc.length > 0 ? { cc: email.cc } : {}),
        ...(email.bcc && email.bcc.length > 0 ? { bcc: email.bcc } : {}),
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: email.attachments?.map((a) => ({
          filename: a.filename,
          content: base64(a.content),
          content_type: a.contentType,
        })),
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { id?: string };
    return { id: body.id ?? null };
  }
}

export class FakeMailer implements Mailer {
  readonly sent: OutboundEmail[] = [];
  private nextId = 1;

  async send(email: OutboundEmail): Promise<SentEmail> {
    this.sent.push(email);
    return { id: `fake-${this.nextId++}` };
  }
}
