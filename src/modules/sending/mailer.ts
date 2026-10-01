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
  subject: string;
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
        from: this.from,
        to: [email.to],
        ...(email.cc && email.cc.length > 0 ? { cc: email.cc } : {}),
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
