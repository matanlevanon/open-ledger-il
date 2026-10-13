import type { demo as en } from '../en/demo';

/** R26, R29: ההדגמה הציבורית. */
export const demo: Record<keyof typeof en, string> = {
  'demo.banner': 'הדגמה. נתוני הדוגמה לקריאה בלבד. הטיוטות שלכם פרטיות ונמחקות 30 דקות אחרי שתצאו. אל תזינו מידע אישי אמיתי.',
  'demo.bannerAdmin': 'מנהל ההדגמה: סט הדוגמה. כל שינוי כאן נרשם ביומן ונשאר אחרי האיפוס הלילי.',
  'demo.cta': 'Ledger משלכם',
  'demo.settingsLocked': 'לקריאה בלבד בהדגמה. ב-Ledger שלכם משנים את כל זה כאן.',
  'demo.readOnly': 'לקריאה בלבד בהדגמה. נתוני הדוגמה משותפים לכל המבקרים.',
  'demo.readOnlyDocument': 'לקריאה בלבד בהדגמה. שכפלו אותו כדי לקבל טיוטה פרטית משלכם.',
  'demo.previewNote': 'הדגמה: הפקה, שליחה ורישום תשלום מציגים תצוגה מקדימה. שום דבר לא מופק או נשלח.',
  'demo.issuePreview': 'הפקה (תצוגה מקדימה)',
  'demo.receiptPreview': 'רישום תשלום (תצוגה מקדימה)',
  'demo.sendPreview': 'שליחה במייל (תצוגה מקדימה)',
  'demo.signingPreview': 'תצוגה מקדימה של דף החתימה',
  'demo.signingNote': 'הדגמה: דף החתימה נפתח כתצוגה מקדימה. שום דבר לא נשלח ולא נשמר כחתום.',
  'demo.preview.title': 'תצוגה מקדימה של המייל',
  'demo.preview.note': 'ב-Ledger שלכם המייל הזה נשלח ללקוח.',
  'demo.preview.to': 'אל',
  'demo.preview.subject': 'נושא',
};
