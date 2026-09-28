/** Alerts to Slack #claude-scheduled-tasks through an incoming webhook (SLACK_WEBHOOK_URL secret). */

export interface Notifier {
  /** Returns false when the alert could not be sent. Never throws. */
  send(text: string): Promise<boolean>;
}

export function slackNotifier(webhookUrl: string | undefined, fetcher: typeof fetch): Notifier {
  return {
    async send(text) {
      if (!webhookUrl) {
        console.warn('ita_alert_not_sent', 'SLACK_WEBHOOK_URL is not set');
        return false;
      }
      try {
        const res = await fetcher(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        return res.ok;
      } catch {
        console.warn('ita_alert_not_sent', 'Slack did not answer');
        return false;
      }
    },
  };
}
