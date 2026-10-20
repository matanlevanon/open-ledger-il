import { usePreferences } from '../app/preferences';
import { type MessageKey, useT } from '../i18n';
import { HelpTip } from './HelpTip';

/** The product site. Hebrew pages sit at the root, English under /en. */
export const HELP_SITE = 'https://open-ledger.dev';

interface Guide {
  /** The help page, scripts/help/<lang>/<page>.md on the site. */
  page: string;
  /** Heading ids on that page, per language. They come from the heading text, so each language has its own. */
  anchor?: { en: string; he: string };
  text: MessageKey;
}

/** Every "?" with a link to the site's help. Keep the anchors in step with the help pages' headings. */
export const GUIDES = {
  business: { page: 'first-sign-in', anchor: { en: 'business-profile', he: 'פרטי-העסק' }, text: 'help.guide.business' },
  brands: { page: 'first-sign-in', anchor: { en: 'logo-and-signature', he: 'לוגו-וחתימה' }, text: 'help.guide.brands' },
  issuing: { page: 'first-invoice', text: 'help.guide.issuing' },
  numbering: { page: 'first-sign-in', anchor: { en: 'numbering-if-you-used-another-system-before', he: 'מספור-אם-עבדתם-קודם-בתוכנה-אחרת' }, text: 'help.guide.numbering' },
  email: { page: 'email', text: 'help.guide.email' },
  mcp: { page: 'connect-claude', text: 'help.guide.mcp' },
  api: { page: 'api', text: 'help.guide.api' },
  paymentMethods: { page: 'payment-providers', text: 'help.guide.paymentMethods' },
  signature: { page: 'digital-signature', text: 'help.guide.signature' },
  expenses: { page: 'expenses', text: 'help.guide.expenses' },
  inbox: { page: 'expenses', anchor: { en: 'forward-receipts-by-email', he: 'העברת-קבלות-במייל' }, text: 'help.guide.inbox' },
  driveFolder: { page: 'expenses', anchor: { en: 'connect-it-once', he: 'חיבור-פעם-אחת' }, text: 'help.guide.driveFolder' },
  indexSheet: { page: 'expenses', anchor: { en: 'an-index-sheet-if-you-keep-one', he: 'גיליון-אינדקס-למי-שמנהל-אחד' }, text: 'help.guide.indexSheet' },
  financy: { page: 'expenses', anchor: { en: 'bank-and-card-transactions', he: 'תנועות-בבנק-ובכרטיסי-אשראי' }, text: 'help.guide.financy' },
  upload: { page: 'expenses', anchor: { en: 'upload', he: 'העלאה' }, text: 'help.guide.upload' },
  backups: { page: 'updates-backups', anchor: { en: 'backups', he: 'גיבויים' }, text: 'help.guide.backups' },
  updates: { page: 'updates-backups', anchor: { en: 'check-for-updates', he: 'בדיקת-עדכונים' }, text: 'help.guide.updates' },
} satisfies Record<string, Guide>;

export type GuideId = keyof typeof GUIDES;

/** The help page address in the reader's language. */
export function guideUrl(id: GuideId, locale: 'en' | 'he'): string {
  const guide: Guide = GUIDES[id];
  const base = locale === 'he' ? `${HELP_SITE}/help/${guide.page}/` : `${HELP_SITE}/en/help/${guide.page}/`;
  return guide.anchor ? `${base}#${encodeURIComponent(guide.anchor[locale])}` : base;
}

/** A "?" that opens a short explanation and a link to the matching help section on the site. */
export function GuideTip({ id, inline = true }: { id: GuideId; inline?: boolean }) {
  const t = useT();
  const { locale } = usePreferences();
  return <HelpTip inline={inline} label={t('help.tipLabel')} text={t(GUIDES[id].text)} href={guideUrl(id, locale)} linkLabel={t('help.readGuide')} />;
}
