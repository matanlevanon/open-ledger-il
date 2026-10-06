import type { ita as en } from '../en/ita';

export const ita: Record<keyof typeof en, string> = {
  'ita.title': 'רשות המסים',

  // Refusal choices
  'ita.choice.cancel.label': 'ביטול החשבונית',
  'ita.choice.cancel.hint': 'בטל אותה והודע לרשות המסים.',
  'ita.choice.continue.label': 'הנפקה ללא מספר',
  'ita.choice.continue.hint': 'הלקוח לא יוכל לנכות מע"מ תשומות.',
  'ita.choice.reverseCharge.label': 'החזרת חיוב',
  'ita.choice.reverseCharge.hint': 'דורש את הסכמת הלקוח. מנפיק חשבונית ללא מע"מ.',
  'ita.choice.furtherObjection.label': 'בקשת שימוע',
  'ita.choice.furtherObjection.hint': 'שלח השגה, ולאחר מכן בקש שוב לאחר השימוע.',

  // ITA login callback
  'ita.callbackError.state': 'קישור ההתחברות לרשות המסים פג. התחבר שוב.',
  'ita.callbackError.denied': 'ההתחברות לרשות המסים בוטלה. התחבר שוב.',
  'ita.callbackError.default': 'ההתחברות לרשות המסים נכשלה. התחבר שוב.',
  'ita.connectedNotice': 'החיבור לרשות המסים בוצע.',

  // General
  'ita.loadingStatus': 'טוען את סטטוס רשות המסים.',
  'ita.requestFailed': 'הבקשה נכשלה.',
  'ita.notScheduled': 'לא מתוזמן',
  'ita.documentFallback': 'מסמך {id}',
  'ita.docLabelDraft': 'טיוטת {type} {id}',
  'ita.docLabelNumbered': '{type} מס\' {number}',
  'ita.forCustomer': 'עבור {name}',
  'ita.beforeVat': '· {amount} לפני מע"מ',

  // Allocation status labels
  'ita.status.pending': 'בניסיון חוזר',
  'ita.status.stalled': 'השתמש באפליקציית האינטרנט',
  'ita.status.failed': 'דורש תיקון',

  // Connection card
  'ita.connection.title': 'חיבור',
  'ita.renewal.test': 'בדיקת חידוש',
  'ita.route.check': 'בדיקת נתיב',
  'ita.route.running': 'בודק…',
  'ita.route.direct': 'ישיר',
  'ita.route.relay': 'דרך הממסר',
  'ita.route.reached': '{name} (מ-{from}): הגיע לרשות המסים, HTTP {status}.',
  'ita.route.blocked': '{name} (מ-{from}): נחסם, HTTP {status}. {reply}',
  'ita.route.failed': 'בדיקת הנתיב לא רצה.',
  'ita.renewal.running': 'מחדש…',
  'ita.renewal.ok': 'רשות המסים חידשה את ההתחברות. הקריאה יצאה מ-{from}.',
  'ita.renewal.failed': 'רשות המסים סירבה לחידוש. {reason} הקריאה יצאה מ-{from}.',
  'ita.connection.notConnected': 'לא מחובר.',
  'ita.connection.active': 'מחובר ל-{environment}. ההתחברות תפוג בעוד {days} ימים.',
  'ita.connection.reconnectRequired': 'נדרשת התחברות מחדש ב-{environment}.',
  'ita.connection.connectToIta': 'התחבר לרשות המסים',
  'ita.connection.connectAgain': 'התחבר שוב',
  'ita.connection.environmentHint': 'סביבה: {environment}. התחבר עם קוד המשתמש שלך ברשות המסים והקוד החד-פעמי.',
  'ita.banner.reconnectRequired': 'ההתחברות לרשות המסים הפסיקה לעבוד. התחבר שוב כדי לקבל מספרי הקצאה.',
  'ita.banner.reloginSoon': 'ההתחברות שלך לרשות המסים תפוג בעוד {days} ימים. התחבר שוב עכשיו.',

  // Refused invoices card
  'ita.refused.title': 'חשבוניות שסורבו',
  'ita.refused.none': 'אין חשבוניות שסורבו.',
  'ita.refused.hearingRequested': 'שימוע התבקש.',
  'ita.refused.openPortal': 'פתח את פורטל רשות המסים',
  'ita.refused.requestAgain': 'בקש שוב',
  'ita.refused.description': 'רשות המסים סירבה לחשבונית הזו. בחר אפשרות אחת.',

  // Allocation queue card
  'ita.queue.title': 'תור הקצאה',
  'ita.queue.none': 'אין דבר בהמתנה.',
  'ita.queue.triedTimes': 'נוסה {attempts} פעמים. הניסיון הבא {next}.',
  'ita.queue.stalled': 'אין מענה כבר 24 שעות. בקש את המספר באפליקציית האינטרנט של רשות המסים והזן אותו כאן.',
  'ita.queue.failedDefault': 'רשות המסים דחתה את הבקשה.',
  'ita.queue.retryNow': 'נסה שוב עכשיו',
  'ita.queue.openWebApp': 'פתח את אפליקציית האינטרנט של רשות המסים',
  'ita.queue.allocationNumberLabel': 'מספר הקצאה',
  'ita.queue.noteLabel': 'הערה',
  'ita.queue.notePlaceholder': 'מאפליקציית האינטרנט של רשות המסים',
  'ita.queue.saveNumber': 'שמור מספר',

  // Documents without numbers card
  'ita.withoutNumbers.title': 'מסמכים ללא מספר',
  'ita.withoutNumbers.none': 'לכל חשבונית מס מזכה יש מספר.',
  'ita.withoutNumbers.colDocument': 'מסמך',
  'ita.withoutNumbers.colClient': 'לקוח',
  'ita.withoutNumbers.colDate': 'תאריך',
  'ita.withoutNumbers.colBeforeVat': 'לפני מע"מ',
  'ita.withoutNumbers.colWhy': 'סיבה',
  'ita.withoutNumbers.issuedWithoutNumber': 'הונפק ללא מספר',
};
