import type { demo as en } from '../en/demo';

/** R26: ההדגמה הציבורית. */
export const demo: Record<keyof typeof en, string> = {
  'demo.banner': 'הדגמה. העותק שלכם מתאפס כל לילה ב-03:00. אל תזינו מידע אישי אמיתי.',
  'demo.bannerAdmin': 'מנהל ההדגמה: סט הדוגמה. כל שינוי כאן נרשם ביומן ונשאר אחרי האיפוס הלילי.',
  'demo.cta': 'Ledger משלכם',
  'demo.settingsLocked': 'הדגמה: ההגדרות לקריאה בלבד. ב-Ledger שלכם משנים את כל זה כאן. שתי פעולות פתוחות בהדגמה: המעבר לעוסק מורשה (לשונית מס) והוספת עסק.',
  'demo.preview.title': 'תצוגה מקדימה של המייל',
  'demo.preview.note': 'ב-Ledger שלכם המייל הזה נשלח ללקוח.',
  'demo.preview.to': 'אל',
  'demo.preview.subject': 'נושא',
};
