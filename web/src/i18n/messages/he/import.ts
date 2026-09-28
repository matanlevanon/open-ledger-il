import type { importFeature as en } from '../en/import';

export const importFeature: Record<keyof typeof en, string> = {
  // ImportPage.tsx
  'import.page.title': 'ייבוא',
  'import.page.subtitle': 'ייבוא הלקוחות הקיימים והחשבוניות הקודמות שלך ל-Open Ledger IL. ייבוא חוזר לא יוצר כפילויות.',
  'import.page.tabsAriaLabel': 'מקור ייבוא',
  'import.tab.customers': 'לקוחות קיימים',
  'import.tab.uploads': 'חשבוניות קודמות',

  'import.uploads.title': 'חשבוניות קודמות',
  'import.uploads.hint': 'מסמך שהנפקת במערכת אחרת לפני Open Ledger IL. הוא לעולם לא מקבל מספר בסדרה של Open Ledger IL.',
  'import.uploads.chooseFiles': 'בחר קובצי PDF',
  'import.uploads.uploading': 'מעלה',
  'import.uploads.extractionFailed': 'קריאה אוטומטית נכשלה ({message}). מלא את השדות ידנית.',
  'import.uploads.filed': 'תויק כמסמך חיצוני מספר {id}.',
  'import.uploads.field.source': 'מערכת מקור',
  'import.uploads.field.documentType': 'סוג מסמך',
  'import.uploads.field.originalNumber': 'מספר מקורי',
  'import.uploads.field.issueDate': 'תאריך הנפקה',
  'import.uploads.field.client': 'לקוח מותאם',
  'import.uploads.field.noClientMatch': 'ללא התאמה',
  'import.uploads.field.clientName': 'שם הלקוח (כפי שמופיע)',
  'import.uploads.field.clientTaxId': 'מספר עוסק של הלקוח',
  'import.uploads.field.currency': 'מטבע',
  'import.uploads.field.amountBeforeVat': 'סכום לפני מע"מ',
  'import.uploads.field.vatAmount': 'מע"מ',
  'import.uploads.field.total': 'סה"כ',
  'import.uploads.field.paidStatus': 'סטטוס תשלום',
  'import.uploads.createClient': 'צור לקוח חדש בשם זה',
  'import.uploads.fileButton': 'תייק מסמך זה',

  // Existing customers tab (fields passed to CsvImportSection)
  'import.waveCustomers.title': 'לקוחות קיימים',
  'import.waveCustomers.hint': 'ייצא את הלקוחות שלך כקובץ CSV מכל מערכת, ולאחר מכן התאם את העמודות למטה.',
  'import.waveCustomers.field.nameEn': 'שם הלקוח',
  'import.waveCustomers.field.nameHe': 'שם בעברית',
  'import.waveCustomers.field.companyId': 'ח"פ / מספר עוסק',
  'import.waveCustomers.field.vatNumber': 'מספר עוסק מורשה (אם שונה)',
  'import.waveCustomers.field.country': 'מדינה (קוד בן שתי אותיות)',
  'import.waveCustomers.field.currency': 'מטבע',
  'import.waveCustomers.field.email': 'דוא"ל',
  'import.waveCustomers.field.phone': 'טלפון',
  'import.waveCustomers.field.addressEn': 'כתובת',
  'import.waveCustomers.field.notes': 'הערות',


  // CsvImportSection.tsx
  'import.csv.chooseFile': 'בחירת קובץ CSV',
  'import.csv.cancelButton': 'ביטול',
  'import.csv.readError': 'קריאת הקובץ נכשלה. ודא שמדובר בייצוא CSV.',
  'import.csv.rowsFound': '{count} שורות נמצאו. התאם כל שדה לעמודה, ואז ייבא.',
  'import.csv.noColumn': 'ללא עמודה',
  'import.csv.importing': 'מייבא...',
  'import.csv.importButton': 'ייבוא',
  'import.csv.importFailed': 'הייבוא נכשל. בדוק את התאמת השדות ונסה שוב.',
  'import.csv.importedToast': 'יובאו: {created} נוצרו, {updated} עודכנו, {skipped} דולגו.',
  'import.csv.summaryLine': '{total} שורות: {created} נוצרו, {updated} עודכנו, {skipped} דולגו.',
  'import.csv.rowError': 'שורה {row}: {message}',
  'import.csv.andMore': 'ועוד {count}...',


};
