import type { reports as en } from '../en/reports';

export const reports: Record<keyof typeof en, string> = {
  'unified.business': 'העסק',
  'unified.title': 'מבנה אחיד',
  'unified.subtitle': 'הפקת קבצים במבנה אחיד, גרסה 1.31, לרשות המסים',
  'unified.dialogTitle': 'הפקת הקבצים',
  'unified.drive': 'כונן',
  'unified.from': 'מתאריך',
  'unified.to': 'עד תאריך',
  'unified.help': 'כולל מסמכים שתאריכם בטווח. קובץ ה-ZIP מכיל את OPENFRMT עם INI.TXT ו-BKMVDATA. חלץ אותו לשורש הכונן שבחרת.',
  'unified.create': 'הפקת קבצים',
  'unified.working': 'מפיק...',
  'unified.downloadAgain': 'הורדה חוזרת',
  'unified.summaryTitle': 'סיכום ההפקה (נספח 4, סעיף 5.4)',
  'unified.typesTitle': 'פירוט לפי סוג מסמך (סעיף 2.6)',
  'unified.print': 'הדפסה',
  'unified.error': 'לא ניתן להפיק את הקובץ במבנה אחיד.',
  'reports.title': 'דוחות',

  // Tabs
  'reports.tab.income': 'הכנסות',
  'reports.tab.expenses': 'הוצאות',
  'reports.tab.profitLoss': 'רווח והפסד',
  'reports.tab.ceiling': 'תקרה',
  'reports.tab.pack': 'חבילה חודשית',

  // Shared across tabs
  'reports.totalLabel': 'סה"כ:',
  'reports.downloadCsv': 'הורד CSV',
  'reports.downloadXlsx': 'הורד XLSX',

  // Income tab
  'reports.income.colDate': 'תאריך',
  'reports.income.colType': 'סוג',
  'reports.income.colClient': 'לקוח',
  'reports.income.colCurrency': 'מטבע',
  'reports.income.colAmountIls': 'סכום בשקלים',
  'reports.income.empty': 'אין הכנסות בתקופה הזו',

  // Expenses tab
  'reports.expenses.colDate': 'תאריך',
  'reports.expenses.colSupplier': 'ספק',
  'reports.expenses.colCategory': 'קטגוריה',
  'reports.expenses.colAmountIls': 'סכום בשקלים',
  'reports.expenses.empty': 'אין הוצאות בתקופה הזו',

  // Profit and loss tab
  'reports.profitLoss.title': 'רווח והפסד לפי חודש',
  'reports.profitLoss.empty': 'אין נתונים בתקופה הזו',
  'reports.profitLoss.colMonth': 'חודש',
  'reports.profitLoss.colIncome': 'הכנסות',
  'reports.profitLoss.colExpenses': 'הוצאות',
  'reports.profitLoss.colNet': 'נטו',
  'reports.profitLoss.netForPeriod': 'נטו לתקופה:',
  'reports.profitLoss.advanceBaseTitle': 'בסיס מקדמות (תקבולים בפועל)',
  'reports.profitLoss.totalReceived': 'סה"כ התקבל:',

  // Ceiling tab
  'reports.ceiling.emptyTitle': 'לא הוגדרה תקרה',
  'reports.ceiling.emptyDescription': 'הוסף שורת תקרה בהגדרות עבור השנה הזו.',
  'reports.ceiling.turnoverToDate': 'מחזור עד כה',
  'reports.ceiling.openPaymentRequests': 'בקשות תשלום פתוחות',
  'reports.ceiling.legalMode': 'מעמד משפטי',
  'reports.ceiling.legalModePatur': 'עוסק פטור',
  'reports.ceiling.legalModeMurshe': 'עוסק מורשה',

  // Monthly pack tab
  'reports.pack.description': 'סיכום PDF, ייצוא פירוט ב-XLSX וקובץ ZIP של קבצי הוצאות, אחד לכל חודש קלנדרי.',
  'reports.pack.running': 'מריץ...',
  'reports.pack.runNow': 'הרץ את החודש הזה עכשיו',
  'reports.pack.runError': 'הרצת החבילה נכשלה.',
  'reports.pack.emptyTitle': 'אין עדיין חבילה',
  'reports.pack.emptyDescription': 'החבילה רצה אוטומטית בחמישי לכל חודש.',
  'reports.pack.colPeriod': 'תקופה',
  'reports.pack.colIncome': 'הכנסות',
  'reports.pack.colExpenses': 'הוצאות',
  'reports.pack.colExpenseFiles': 'קבצי הוצאות',
  'reports.pack.colEmailed': 'נשלח באימייל',
  'reports.pack.statusSent': 'נשלח',
  'reports.pack.statusFailed': 'נכשל',
  'reports.pack.statusNotSent': 'לא נשלח',
};
