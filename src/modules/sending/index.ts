import { todayIsrael } from '../../core/db';
import type { ModuleDef } from '../../core/module';
import type { Env } from '../../env';
import { type Mailer, ResendMailer } from './mailer';
import { REMINDERS_CRON, runRemindersCron } from './reminders';
import { createSendingRoutes } from './routes';

function defaultMailer(env: Env): Mailer {
  if (!env.MAIL_API_KEY) throw new Error('MAIL_API_KEY is not set. Outgoing email is unavailable.');
  if (!env.MAIL_FROM) throw new Error('MAIL_FROM is not set. Outgoing email is unavailable.');
  return new ResendMailer(env.MAIL_API_KEY, env.MAIL_FROM);
}

/** Sending module (R06): consent, email, WhatsApp share links, send log, reminders. */
export function createSendingModule(resolveMailer: (env: Env) => Mailer = defaultMailer): ModuleDef {
  return {
    name: 'sending',
    basePath: '/sending',
    routes: createSendingRoutes(resolveMailer),
    crons: [REMINDERS_CRON],
    async scheduled(controller, env) {
      if (controller.cron !== REMINDERS_CRON) return;
      await runRemindersCron(env, resolveMailer(env), todayIsrael());
    },
  };
}

export const sendingModule = createSendingModule();

export { PUBLIC_API_PREFIXES } from './public-paths';
export { acceptConsent, consentHistory, consentState, isConsentGranted, requestConsent, revokeConsent } from './consent';
export { type Mailer, type OutboundEmail, FakeMailer, ResendMailer } from './mailer';
export { sendDocumentEmail } from './send';
export { createWhatsAppLink } from './whatsapp';
export { runReminders } from './reminders';
export { verifySendToken, signSendToken } from './tokens';
