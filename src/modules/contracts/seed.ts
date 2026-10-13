import type { FieldDef, ServiceModel, TemplateKind } from './types';

/** R25: what a business starts with in Settings > Contract templates. */
export interface SeedSet {
  templates: {
    name: string;
    /** A note for the owner, kept in the source and the docs. Templates have no description column. */
    description?: string;
    kind: TemplateKind;
    bodyEn: string;
    bodyHe: string;
    fields: FieldDef[];
  }[];
  services: {
    nameEn: string;
    nameHe: string;
    model: ServiceModel;
    modelLabelEn?: string | null;
    descriptionEn: string;
    descriptionHe: string;
    items: { labelEn: string; labelHe: string }[];
  }[];
}

const f = (field: Partial<FieldDef> & Pick<FieldDef, 'key' | 'kind'>): FieldDef => ({
  labelEn: '',
  labelHe: '',
  required: false,
  options: [],
  multiple: false,
  allowOther: false,
  ...field,
});

const SAMPLE_SIGNATURES: FieldDef[] = [
  f({ key: 'signer_name', kind: 'signer_input', inputType: 'name', labelEn: 'Signer name', labelHe: 'שם החותם', required: true }),
  f({ key: 'signer_role', kind: 'signer_input', inputType: 'role', labelEn: 'Signer role', labelHe: 'תפקיד החותם' }),
  f({ key: 'owner_signature', kind: 'signature', party: 'owner', labelEn: 'Our signature', labelHe: 'חתימת העסק', required: true }),
  f({ key: 'client_signature', kind: 'signature', party: 'client', labelEn: 'Client signature', labelHe: 'חתימת הלקוח', required: true }),
  f({ key: 'owner_signed_date', kind: 'signed_date', party: 'owner', labelEn: 'Signed date', labelHe: 'תאריך חתימה' }),
  f({ key: 'client_signed_date', kind: 'signed_date', party: 'client', labelEn: 'Signed date', labelHe: 'תאריך חתימה' }),
];

const SIGNATURE_TABLE_EN = `| **For {{business_name}}** | **For {{client_name}}** |
|---|---|
| Signature: {{owner_signature}} | Name: {{signer_name}}, {{signer_role}} |
| Date: {{owner_signed_date}} | Signature: {{client_signature}} |
| | Date: {{client_signed_date}} |`;

const SIGNATURE_TABLE_HE = `| **בשם {{business_name}}** | **בשם {{client_name}}** |
|---|---|
| חתימה: {{owner_signature}} | שם: {{signer_name}}, {{signer_role}} |
| תאריך: {{owner_signed_date}} | חתימה: {{client_signature}} |
| | תאריך: {{client_signed_date}} |`;

/**
 * The neutral starter set: a Service Agreement with the standing terms and a Work Order for each
 * project. Plain wording, no governing-law city, no business-specific clauses. Template. Have a
 * lawyer review before use.
 */
export const SAMPLE_SEED: SeedSet = {
  templates: [
    {
      name: 'Service Agreement',
      description: 'Template. Have a lawyer review before use.',
      kind: 'contract',
      bodyEn: `# Service Agreement

Between {{business_name}} ("the Provider") and {{client_name}}, company no. {{client_tax_id}} ("the Client").

## 1. What this agreement covers

These terms govern every service the Provider gives the Client. Each project is set out in a separate Work Order that refers to this agreement. If a Work Order and this agreement differ, the Work Order wins for that project only.

## 2. Term

This agreement starts on {{start_date}}. It stays in force between projects, until either party ends it by written notice. Ending it does not cancel a Work Order already signed, unless both parties agree.

## 3. Fees and payment

Fees are set in each Work Order. The Provider invoices as the Work Order says. The Client pays within {{payment_days}} days of the invoice.

## 4. Confidentiality

Each party keeps the other party's confidential information private and uses it only for the services.

## 5. Work product

Once paid in full, the Client owns the deliverables made for it under a Work Order. The Provider keeps its own tools, methods and earlier work.

## 6. Liability

Neither party is liable for indirect loss. Each party's total liability under a Work Order is capped at the fees paid under that Work Order.

## 7. Notices

Notices go by email to the addresses the parties give each other.

${SIGNATURE_TABLE_EN}
`,
      bodyHe: `# הסכם שירותים

בין {{business_name}} ("נותן השירות") לבין {{client_name}}, ח.פ. {{client_tax_id}} ("הלקוח").

## 1. מה ההסכם מכסה

תנאים אלה חלים על כל שירות שנותן השירות נותן ללקוח. כל פרויקט מוגדר בהזמנת עבודה נפרדת שמפנה להסכם זה. אם הזמנת עבודה שונה מהסכם זה, הזמנת העבודה גוברת לגבי אותו פרויקט בלבד.

## 2. תקופה

ההסכם מתחיל ב-{{start_date}}. הוא נשאר בתוקף גם בין פרויקטים, עד שאחד הצדדים מסיים אותו בהודעה בכתב. סיום ההסכם אינו מבטל הזמנת עבודה שכבר נחתמה, אלא אם שני הצדדים מסכימים.

## 3. מחיר ותשלום

המחיר נקבע בכל הזמנת עבודה. נותן השירות מוציא חשבונית כפי שנקבע בהזמנת העבודה. הלקוח משלם תוך {{payment_days}} ימים מהחשבונית.

## 4. סודיות

כל צד שומר בסוד את המידע הסודי של הצד השני ומשתמש בו רק לצורך השירותים.

## 5. תוצרים

לאחר תשלום מלא, הלקוח הוא הבעלים של התוצרים שנעשו עבורו לפי הזמנת עבודה. נותן השירות שומר על הכלים, השיטות והעבודות הקודמות שלו.

## 6. אחריות

אף צד אינו אחראי לנזק עקיף. האחריות הכוללת של כל צד לפי הזמנת עבודה מוגבלת לסכום ששולם לפי אותה הזמנת עבודה.

## 7. הודעות

הודעות נשלחות בדוא"ל לכתובות שהצדדים מסרו זה לזה.

${SIGNATURE_TABLE_HE}
`,
      fields: [
        f({ key: 'business_name', kind: 'business', source: 'name', labelEn: 'Business name', labelHe: 'שם העסק', required: true }),
        f({ key: 'client_name', kind: 'client', source: 'name', labelEn: 'Client name', labelHe: 'שם הלקוח', required: true }),
        f({ key: 'client_tax_id', kind: 'client', source: 'tax_id', labelEn: 'Company number', labelHe: 'מספר חברה' }),
        f({ key: 'start_date', kind: 'owner_input', inputType: 'date', labelEn: 'Start date', labelHe: 'תאריך התחלה', mapsTo: 'start_date' }),
        f({ key: 'payment_days', kind: 'owner_input', inputType: 'number', labelEn: 'Days to pay', labelHe: 'ימים לתשלום', defaultValue: '30' }),
        ...SAMPLE_SIGNATURES,
      ],
    },
    {
      name: 'Work Order',
      description: 'Template. Have a lawyer review before use.',
      kind: 'work_order',
      bodyEn: `# Work Order {{work_order_number}}

Between {{business_name}} and {{client_name}}.

This Work Order is made under the Service Agreement signed on {{terms_signed_date}}. That agreement applies to this project.

## Scope

{{scope}}

{{scope_notes}}

## Fee

{{scope:fees}}

{{fee}}

Start date: {{start_date}}

${SIGNATURE_TABLE_EN}
`,
      bodyHe: `# הזמנת עבודה {{work_order_number}}

בין {{business_name}} לבין {{client_name}}.

הזמנת עבודה זו נעשית לפי הסכם השירותים שנחתם ב-{{terms_signed_date}}. ההסכם חל על פרויקט זה.

## היקף

{{scope}}

{{scope_notes}}

## מחיר

{{scope:fees}}

{{fee}}

תאריך התחלה: {{start_date}}

${SIGNATURE_TABLE_HE}
`,
      fields: [
        f({ key: 'work_order_number', kind: 'owner_input', inputType: 'text', labelEn: 'Work order number', labelHe: 'מספר הזמנת עבודה', required: true, defaultValue: 'WO-{YYYY}-{NNN}' }),
        f({ key: 'business_name', kind: 'business', source: 'name', labelEn: 'Business name', labelHe: 'שם העסק', required: true }),
        f({ key: 'client_name', kind: 'client', source: 'name', labelEn: 'Client name', labelHe: 'שם הלקוח', required: true }),
        f({ key: 'terms_signed_date', kind: 'owner_input', inputType: 'date', labelEn: 'Service Agreement signed on', labelHe: 'תאריך חתימת הסכם השירותים', role: 'terms_date' }),
        f({ key: 'scope', kind: 'choice', binding: 'services', multiple: true, allowOther: true, labelEn: 'Scope', labelHe: 'היקף', required: true, mapsTo: 'amount' }),
        f({ key: 'scope_notes', kind: 'owner_input', inputType: 'multiline', labelEn: 'Scope notes', labelHe: 'הערות להיקף' }),
        f({ key: 'fee', kind: 'owner_input', inputType: 'money', labelEn: 'Fee', labelHe: 'מחיר' }),
        f({ key: 'start_date', kind: 'owner_input', inputType: 'date', labelEn: 'Start date', labelHe: 'תאריך התחלה', mapsTo: 'start_date' }),
        ...SAMPLE_SIGNATURES,
      ],
    },
  ],
  services: [],
};

/** Every business starts with the neutral sample. The owner writes their own terms. */
export function seedFor(_businessId: number): SeedSet {
  return SAMPLE_SEED;
}
