/**
 * Slack reminder for accountant access nearing its end date. Behind an interface so tests never
 * call the internet (CLAUDE.md rule 5, runs/_common.md definition of done #4).
 */
export interface ExpiryNotice {
  email: string;
  name: string | null;
  accessEndsOn: string;
}

export interface AccessNotifier {
  remind(notice: ExpiryNotice): Promise<void>;
}

/** Posts to SLACK_WEBHOOK_URL. A missing URL is a no-op, so a fresh environment never throws. */
export class SlackAccessNotifier implements AccessNotifier {
  constructor(private readonly webhookUrl: string | undefined) {}

  async remind(notice: ExpiryNotice): Promise<void> {
    if (!this.webhookUrl) return;
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `Accountant access for ${notice.name ?? notice.email} (${notice.email}) ends on ${notice.accessEndsOn} in 14 days. Renew it or let it lapse from the Accountant screen.`,
      }),
    });
  }
}

/** Captures reminders in memory. Used by tests. */
export class FakeAccessNotifier implements AccessNotifier {
  readonly reminders: ExpiryNotice[] = [];

  async remind(notice: ExpiryNotice): Promise<void> {
    this.reminders.push(notice);
  }
}
