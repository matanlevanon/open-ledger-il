import type { access as en } from '../en/access';

export const access: Record<keyof typeof en, string> = {
  // AccessPage.tsx
  'access.title': 'רואה חשבון',
  'access.tablistAriaLabel': 'רואה חשבון',
  'access.tab.users': 'משתמשים',
  'access.tab.log': 'יומן גישה',

  // Shared owner-only gate (AccessLogTab.tsx, UsersTab.tsx)
  'access.ownerOnly': 'אזור זה מיועד לבעל החשבון בלבד.',
  'access.loading': 'טוען',

  // AccessLogTab.tsx
  'access.log.errorFallback': 'טעינת יומן הגישה נכשלה.',
  'access.log.caption': 'יומן פעילות רואה חשבון',
  'access.log.colWhen': 'מתי',
  'access.log.colWho': 'מי',
  'access.log.colAction': 'פעולה',
  'access.log.colWhat': 'מה',
  'access.log.colIp': 'כתובת IP',
  'access.log.systemFallback': 'מערכת',
  'access.log.noneFallback': 'ללא',
  'access.log.loadOlder': 'טען ישנים יותר',

  // UsersTab.tsx
  'access.users.errorFallback': 'טעינת המשתמשים נכשלה.',
  'access.users.caption': 'משתמשים עם גישה ל-Open Ledger IL',
  'access.users.colEmail': 'דוא"ל',
  'access.users.colName': 'שם',
  'access.users.colRole': 'תפקיד',
  'access.users.colStatus': 'סטטוס',
  'access.users.colAccessEnds': 'תוקף גישה עד',
  'access.users.colFeatures': 'הרשאות',
  'access.users.noneFallback': 'ללא',
  'access.users.revoke': 'ביטול גישה',
  'access.users.revokeConfirm': 'לבטל את הגישה של {email}? פעולה זו מוחקת את החשבון שלו לאלתר.',
  'access.users.inviteAccountant': 'הזמנת רואה חשבון',

  // Status labels (statusLabel())
  'access.status.owner': 'בעלים',
  'access.status.disabled': 'מושבת',
  'access.status.expired': 'פג תוקף',
  'access.status.active': 'פעיל',

  // Role labels
  'access.role.owner': 'בעלים',
  'access.role.accountant': 'רואה חשבון',

  // Feature checkbox labels (features.ts, shared by InviteForm.tsx and UsersTab.tsx)
  'access.feature.incomeDocuments': 'מסמכי הכנסה',
  'access.feature.expenses': 'הוצאות',
  'access.feature.clients': 'לקוחות',
  'access.feature.reports': 'דוחות',
  'access.feature.monthlyPack': 'חבילה חודשית',
  'access.feature.unifiedFile': 'קובץ אחיד',
  'access.feature.pcn874': 'PCN874',
  'access.feature.bankMatches': 'התאמות בנק',
  'access.feature.notes': 'הערות',

  // InviteForm.tsx
  'access.invite.ariaLabel': 'הזמנת רואה חשבון',
  'access.invite.emailLabel': 'דוא"ל',
  'access.invite.nameLabel': 'שם',
  'access.invite.accessEndsOnLabel': 'תוקף הגישה עד',
  'access.invite.featuresLegend': 'הרשאות',
  'access.invite.errorFallback': 'הזמנת רואה החשבון נכשלה.',
  'access.invite.inviting': 'שולח הזמנה',
  'access.invite.sendInvite': 'שליחת הזמנה',
  'access.invite.cancel': 'ביטול',
};
