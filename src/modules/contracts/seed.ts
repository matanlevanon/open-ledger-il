import type { FieldDef, ServiceModel, TemplateKind } from './types';

/** R25: what a business starts with in Settings > Contract templates. */
export interface SeedSet {
  templates: { name: string; kind: TemplateKind; bodyEn: string; bodyHe: string; fields: FieldDef[] }[];
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

/** A short neutral sample. It holds no legal terms: the owner writes their own. */
export const SAMPLE_SEED: SeedSet = {
  templates: [
    {
      name: 'Sample agreement',
      kind: 'contract',
      bodyEn: `# Agreement

This is a sample. Replace this text with your own terms.

Between {{business_name}} and {{client_name}}, company no. {{client_tax_id}}.

**Scope:** {{scope_text}}

**Fee:** {{fee}}, from {{start_date}}.

${SIGNATURE_TABLE_EN}
`,
      bodyHe: `# הסכם

זו דוגמה. החליפו את הטקסט בתנאים שלכם.

בין {{business_name}} לבין {{client_name}}, ח.פ. {{client_tax_id}}.

**היקף:** {{scope_text}}

**מחיר:** {{fee}}, החל מ-{{start_date}}.

${SIGNATURE_TABLE_HE}
`,
      fields: [
        f({ key: 'business_name', kind: 'business', source: 'name', labelEn: 'Business name', labelHe: 'שם העסק', required: true }),
        f({ key: 'client_name', kind: 'client', source: 'name', labelEn: 'Client name', labelHe: 'שם הלקוח', required: true }),
        f({ key: 'client_tax_id', kind: 'client', source: 'tax_id', labelEn: 'Company number', labelHe: 'מספר חברה' }),
        f({ key: 'scope_text', kind: 'owner_input', inputType: 'multiline', labelEn: 'Scope', labelHe: 'היקף', required: true, mapsTo: 'description' }),
        f({ key: 'fee', kind: 'owner_input', inputType: 'money', labelEn: 'Fee', labelHe: 'מחיר', required: true, mapsTo: 'amount' }),
        f({ key: 'start_date', kind: 'owner_input', inputType: 'date', labelEn: 'Start date', labelHe: 'תאריך התחלה', mapsTo: 'start_date' }),
        ...SAMPLE_SIGNATURES,
      ],
    },
    {
      name: 'Sample work order',
      kind: 'work_order',
      bodyEn: `# Work order

This is a sample. Replace this text with your own terms.

Between {{business_name}} and {{client_name}}.

## Services

{{scope}}

## Fees

{{scope:fees}}

Start date: {{start_date}}

${SIGNATURE_TABLE_EN}
`,
      bodyHe: `# הזמנת עבודה

זו דוגמה. החליפו את הטקסט בתנאים שלכם.

בין {{business_name}} לבין {{client_name}}.

## שירותים

{{scope}}

## מחיר

{{scope:fees}}

תאריך התחלה: {{start_date}}

${SIGNATURE_TABLE_HE}
`,
      fields: [
        f({ key: 'business_name', kind: 'business', source: 'name', labelEn: 'Business name', labelHe: 'שם העסק', required: true }),
        f({ key: 'client_name', kind: 'client', source: 'name', labelEn: 'Client name', labelHe: 'שם הלקוח', required: true }),
        f({ key: 'scope', kind: 'choice', binding: 'services', multiple: true, allowOther: true, labelEn: 'Services', labelHe: 'שירותים', required: true, mapsTo: 'amount' }),
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
