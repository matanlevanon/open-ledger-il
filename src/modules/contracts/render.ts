import { type Currency, isCurrency } from '../../core/money';
import { FONT_STACK, fontFaceCss } from '../pdf/fonts';
import { currencySymbol, formatAmount, formatDate } from '../pdf/format';
import { escapeHtml as esc, renderMarkdown } from './markdown';
import {
  type ChoiceValue,
  type ContractLanguage,
  type FieldDef,
  type FieldValue,
  type FieldValues,
  type MoneyValue,
  type Party,
  type ScopeValue,
  type TemplateKind,
} from './types';

/**
 * R25: the contract as HTML. The same HTML feeds the live preview and the PDF engine.
 *
 * Field positions: every field box is an <a href="https://field.ledger.invalid/<name>">. Chrome
 * writes each link into the PDF as a Link annotation with its exact page and rectangle. The PDF
 * step (fields-pdf.ts) reads those rectangles, removes the links and puts an AcroForm field in
 * each. No second measuring pass, and the positions follow the real layout, page breaks included.
 *
 * Hebrew: the HTML engine lays out all text, right to left included. Every value sits in an element
 * with dir="auto", so a Hebrew or mixed value takes its own direction inside an English sentence,
 * and the Hebrew body is a dir="rtl" section. pdf-lib never draws text.
 */

export const FIELD_LINK_PREFIX = 'https://field.ledger.invalid/';

export type BoxKind = 'text' | 'signature';
/** Who filled the value: decides which fields lock in the sent PDF. */
export type BoxGroup = 'owner' | 'signer' | 'owner_signature' | 'client_signature';

export interface FieldBox {
  /** The AcroForm field name: the template key, or key_<service>_<item> for a scope item. */
  name: string;
  /** The template key this box belongs to. */
  key: string;
  kind: BoxKind;
  group: BoxGroup;
  value: string;
}

export interface RenderIdentity {
  nameEn: string;
  nameHe: string;
  logoDataUri?: string | null;
}

export interface EvidenceEvent {
  at: string;
  label: string;
  actor: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface EvidenceView {
  contractId: number;
  title: string;
  templateName: string;
  templateVersion: number;
  sentSha256: string;
  signedContentSha256: string;
  identity: 'email_code' | 'link_only';
  signerEmail: string | null;
  events: EvidenceEvent[];
}

export interface ContractRenderInput {
  title: string;
  kind: TemplateKind;
  language: ContractLanguage;
  bodyEn: string;
  bodyHe: string;
  fields: FieldDef[];
  values: FieldValues;
  identity: RenderIdentity;
  /** preview: field boxes tinted with labels on empty ones. pdf: plain boxes, empty frames. */
  mode: 'preview' | 'pdf';
  /** Preview only: images shown inside signature boxes. The PDF puts them in the field appearance. */
  signatureImages?: Partial<Record<Party, string>>;
  evidence?: EvidenceView | null;
}

export interface ContractRenderResult {
  html: string;
  boxes: FieldBox[];
}

type Lang = 'en' | 'he';

const WORDS = {
  en: { other: 'Other', notes: 'Notes for this service', signatureOf: { owner: 'Signature field: owner', client: 'Signature field: client' } },
  he: { other: 'אחר', notes: 'הערות לשירות', signatureOf: { owner: 'שדה חתימה: העסק', client: 'שדה חתימה: הלקוח' } },
} as const;

export const isMoney = (v: FieldValue | undefined): v is MoneyValue =>
  typeof v === 'object' && v !== null && 'amountMinor' in v && 'currency' in v && typeof v.amountMinor === 'number';
export const isScope = (v: FieldValue | undefined): v is ScopeValue => typeof v === 'object' && v !== null && 'services' in v && Array.isArray(v.services);
export const isChoice = (v: FieldValue | undefined): v is ChoiceValue => typeof v === 'object' && v !== null && 'selected' in v && Array.isArray(v.selected);

export function formatMoney(v: MoneyValue): string {
  if (!isCurrency(v.currency)) return String(v.amountMinor);
  return `${currencySymbol(v.currency as Currency)}${formatAmount(v.amountMinor, v.currency as Currency)}`;
}

const pickLang = (en: string, he: string, lang: Lang) => (lang === 'he' ? he || en : en || he);

/** A choice value as text: every picked option, ___ replaced by its free text. */
export function choiceText(field: FieldDef, v: ChoiceValue | null | undefined, lang: Lang): string {
  if (!v) return '';
  const parts = v.selected.map((s) => {
    const option = field.options.find((o) => o.value === s.value);
    if (!option) return '';
    const label = pickLang(option.labelEn, option.labelHe, lang);
    const text = s.text?.trim() ?? '';
    if (!text) return label;
    return label.includes('___') ? label.replace('___', text) : `${label} ${text}`;
  });
  if (v.other?.trim()) parts.push(`${WORDS[lang].other}: ${v.other.trim()}`);
  return parts.filter(Boolean).join('; ');
}

/** The plain text of a field value, as it prints. Used for the AcroForm value too. */
export function valueText(field: FieldDef, value: FieldValue | undefined, lang: Lang): string {
  if (value === null || value === undefined) return '';
  if (isMoney(value)) return formatMoney(value);
  if (isScope(value)) return value.services.map((s) => pickLang(s.nameEn, s.nameHe, lang)).join(', ');
  if (isChoice(value)) return choiceText(field, value, lang);
  if (typeof value !== 'string') return '';
  if ((field.inputType === 'date' || field.kind === 'signed_date') && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  return value;
}

function groupOf(field: FieldDef): BoxGroup {
  if (field.kind === 'signature') return field.party === 'owner' ? 'owner_signature' : 'client_signature';
  if (field.kind === 'signer_input') return 'signer';
  if (field.kind === 'signed_date') return field.party === 'owner' ? 'owner' : 'signer';
  return 'owner';
}

class BoxCollector {
  readonly boxes = new Map<string, FieldBox>();
  add(box: FieldBox): void {
    if (!this.boxes.has(box.name)) this.boxes.set(box.name, box);
  }
}

function linkOpen(name: string, extraClass: string, title: string | null): string {
  return `<a class="f ${extraClass}" dir="auto" href="${FIELD_LINK_PREFIX}${encodeURIComponent(name)}"${title ? ` data-label="${esc(title)}"` : ''}>`;
}

function textBox(c: BoxCollector, field: FieldDef, name: string, text: string, lang: Lang, mode: 'preview' | 'pdf', block = false): string {
  c.add({ name, key: field.key, kind: 'text', group: groupOf(field), value: text });
  const label = pickLang(field.labelEn, field.labelHe, lang) || field.key;
  const empty = text.trim() === '';
  const shown = empty ? (mode === 'preview' ? esc(label) : '') : esc(text).replace(/\n/g, '<br>');
  const cls = `${block || text.includes('\n') ? 'f-block' : 'f-inline'}${empty ? ' f-empty' : ''}`;
  return `${linkOpen(name, cls, empty ? label : null)}${shown}</a>`;
}

function signatureBox(c: BoxCollector, field: FieldDef, lang: Lang, input: ContractRenderInput): string {
  const party: Party = field.party === 'owner' ? 'owner' : 'client';
  c.add({ name: field.key, key: field.key, kind: 'signature', group: groupOf(field), value: '' });
  const image = input.mode === 'preview' ? input.signatureImages?.[party] : null;
  const inner = image ? `<img src="${esc(image)}" alt="">` : input.mode === 'preview' ? esc(WORDS[lang].signatureOf[party]) : '';
  return `${linkOpen(field.key, 'f-sig', null)}${inner}</a>`;
}

function scopeBlock(c: BoxCollector, field: FieldDef, value: ScopeValue | null, lang: Lang, mode: 'preview' | 'pdf'): string {
  const services = value?.services ?? [];
  if (services.length === 0) return mode === 'preview' ? `<div class="scope">${textBox(c, field, field.key, '', lang, mode, true)}</div>` : '';
  const w = WORDS[lang];
  return `<div class="scope">${services
    .map((s, si) => {
      const name = pickLang(s.nameEn, s.nameHe, lang);
      const model = pickLang(s.modelEn, s.modelHe, lang);
      const description = pickLang(s.descriptionEn, s.descriptionHe, lang);
      const items = s.items.map((it, ii) => `<li>${textBox(c, field, `${field.key}_${si + 1}_${ii + 1}`, pickLang(it.labelEn, it.labelHe, lang), lang, mode)}</li>`);
      if (s.other?.trim()) items.push(`<li>${esc(w.other)}: ${textBox(c, field, `${field.key}_${si + 1}_other`, s.other.trim(), lang, mode)}</li>`);
      const note = s.note?.trim() ? `<p class="scope-note">${esc(w.notes)}: ${textBox(c, field, `${field.key}_${si + 1}_note`, s.note.trim(), lang, mode)}</p>` : '';
      return `<div class="scope-service"><p class="scope-title"><strong>${esc(name)}</strong>${model ? ` · ${esc(model)}` : ''}</p>${
        description ? `<p class="scope-desc">${esc(description)}</p>` : ''
      }${items.length ? `<ul>${items.join('')}</ul>` : ''}${note}</div>`;
    })
    .join('')}</div>`;
}

function feesBlock(c: BoxCollector, field: FieldDef, value: ScopeValue | null, lang: Lang, mode: 'preview' | 'pdf'): string {
  const services = value?.services ?? [];
  if (services.length === 0) return mode === 'preview' ? textBox(c, { ...field, labelEn: 'Fees', labelHe: 'מחיר' }, `${field.key}_fees`, '', lang, mode) : '';
  return `<span class="fees">${services
    .map((s, si) => `<span class="fee-row"><span class="fee-name">${esc(pickLang(s.nameEn, s.nameHe, lang))}</span> ${textBox(c, field, `${field.key}_fee_${si + 1}`, s.fee ? formatMoney(s.fee) : '', lang, mode)}</span>`)
    .join('')}</span>`;
}

function renderBody(body: string, lang: Lang, input: ContractRenderInput, c: BoxCollector): string {
  const byKey = new Map(input.fields.map((f) => [f.key, f]));
  return renderMarkdown(body, (token, block) => {
    const [key, part] = token.split(':') as [string, string | undefined];
    const field = byKey.get(key);
    if (!field) return esc(`{{${token}}}`);
    const value = input.values[key];
    if (field.kind === 'choice' && field.binding === 'services') {
      const scope = isScope(value) ? value : null;
      if (part === 'fees') return feesBlock(c, field, scope, lang, input.mode);
      if (block) return scopeBlock(c, field, scope, lang, input.mode);
    }
    if (field.kind === 'signature') return signatureBox(c, field, lang, input);
    const text = valueText(field, value, lang);
    const html = textBox(c, field, field.key, text, lang, input.mode, block || field.inputType === 'multiline');
    return block ? `<div class="f-line">${html}</div>` : html;
  });
}

function evidenceHtml(e: EvidenceView): string {
  const identity =
    e.identity === 'email_code'
      ? `Identity confirmed by a one-time code sent to ${esc(e.signerEmail ?? '')} and typed on the signing page.`
      : 'Identity confirmed by link only. No email code was used.';
  return `<section class="evidence" dir="ltr" lang="en">
<h2>Evidence of signing</h2>
<p>A simple electronic signature with an evidence trail. The certificate signature on this file marks any change made after signing.</p>
<table class="ev-meta"><tbody>
<tr><th>Document</th><td>${esc(e.title)} (contract ${e.contractId})</td></tr>
<tr><th>Template</th><td>${esc(e.templateName)}, version ${e.templateVersion}</td></tr>
<tr><th>Sent PDF SHA-256</th><td class="hash">${esc(e.sentSha256)}</td></tr>
<tr><th>Signed content SHA-256</th><td class="hash">${esc(e.signedContentSha256)}</td></tr>
<tr><th>Identity</th><td>${identity}</td></tr>
</tbody></table>
<p class="ev-note">Signed content SHA-256 covers the sent PDF hash, the details the signer typed and the signature images. The hash of this whole file is kept in the Ledger.</p>
<table class="ev-events"><thead><tr><th>Time (UTC)</th><th>Event</th><th>By</th><th>IP</th><th>Device</th></tr></thead><tbody>
${e.events
  .map((ev) => `<tr><td>${esc(ev.at.replace('T', ' ').slice(0, 19))}</td><td>${esc(ev.label)}</td><td>${esc(ev.actor ?? '')}</td><td>${esc(ev.ip ?? '')}</td><td class="ua">${esc(ev.userAgent ?? '')}</td></tr>`)
  .join('\n')}
</tbody></table>
</section>`;
}

function styles(mode: 'preview' | 'pdf'): string {
  return `${fontFaceCss()}
@page { size: A4; margin: 16mm 16mm 18mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: ${FONT_STACK}; font-size: 10pt; line-height: 1.5; color: #1a1a1a; background: #fff; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 6mm; border-bottom: 1px solid #dde3eb; padding-bottom: 3mm; margin-bottom: 4mm; }
.head .biz { font-weight: 700; font-size: 12pt; }
.head img { max-height: 14mm; max-width: 40mm; }
.body + .body { border-top: 1px solid #dde3eb; margin-top: 6mm; padding-top: 4mm; }
.body[dir="rtl"] { text-align: right; }
h1 { font-size: 15pt; margin: 0 0 3mm; } h2 { font-size: 12pt; margin: 5mm 0 2mm; } h3, h4 { font-size: 10.5pt; margin: 4mm 0 1.5mm; }
p { margin: 0 0 2.5mm; } ul, ol { margin: 0 0 2.5mm; padding-inline-start: 6mm; } li { margin: 0.5mm 0; }
blockquote { margin: 0 0 2.5mm; padding-inline-start: 6mm; }
hr { border: none; border-top: 1px solid #dde3eb; margin: 4mm 0; }
table.md-table { width: 100%; border-collapse: collapse; margin: 0 0 3mm; break-inside: avoid; }
table.md-table th, table.md-table td { border: 1px solid #dde3eb; padding: 1.8mm 2.5mm; vertical-align: top; text-align: start; }
a.f { color: inherit; text-decoration: none; unicode-bidi: isolate; }
a.f-inline { display: inline-block; min-width: 18mm; max-width: 100%; border-bottom: 0.6pt solid #9aa3af; padding: 0 0.8mm; }
a.f-block { display: block; min-height: 6mm; border-bottom: 0.6pt solid #9aa3af; padding: 0.5mm 0.8mm; }
a.f-sig { display: inline-block; vertical-align: middle; width: 55mm; height: 18mm; border: 0.8pt solid #9aa3af; border-radius: 1.5mm; }
a.f-sig img { width: 100%; height: 100%; object-fit: contain; }
.scope-service { margin: 0 0 3mm; break-inside: avoid; }
.scope-title { margin: 0 0 1mm; } .scope-desc { color: #4b5563; margin: 0 0 1mm; }
.fees { display: inline-block; } .fee-row { display: block; }
.evidence { break-before: page; font-size: 8.5pt; }
.evidence h2 { margin-top: 0; }
.evidence table { width: 100%; border-collapse: collapse; margin: 2mm 0 3mm; }
.evidence th, .evidence td { border: 1px solid #dde3eb; padding: 1.2mm 1.8mm; text-align: left; vertical-align: top; }
.evidence .hash { font-family: monospace; font-size: 7.5pt; word-break: break-all; }
.evidence .ua { font-size: 7pt; word-break: break-word; }
.ev-note { color: #4b5563; }
${
  mode === 'preview'
    ? `a.f { pointer-events: none; background: #eef3ff; border: 1px dashed #1f5fd1; border-radius: 1mm; }
a.f-empty { color: #1f5fd1; font-size: 9pt; }
a.f-sig { display: inline-grid; place-items: center; color: #1f5fd1; background: #f5f8ff; border: 1.5px dashed #1f5fd1; font-size: 9pt; }
body { padding: 6mm; }`
    : ''
}`;
}

/** Renders the contract. Returns the HTML and every field box in it. */
export function renderContract(input: ContractRenderInput): ContractRenderResult {
  const c = new BoxCollector();
  const sections: { lang: Lang; body: string }[] = [];
  const en = input.bodyEn.trim();
  const he = input.bodyHe.trim();
  if (input.language === 'en') sections.push(en ? { lang: 'en', body: input.bodyEn } : { lang: 'he', body: input.bodyHe });
  else if (input.language === 'he') sections.push(he ? { lang: 'he', body: input.bodyHe } : { lang: 'en', body: input.bodyEn });
  else {
    if (en) sections.push({ lang: 'en', body: input.bodyEn });
    if (he) sections.push({ lang: 'he', body: input.bodyHe });
  }
  const bodies = sections.map((s) => `<section class="body" dir="${s.lang === 'he' ? 'rtl' : 'ltr'}" lang="${s.lang}">${renderBody(s.body, s.lang, input, c)}</section>`).join('\n');
  const name = input.identity.nameEn || input.identity.nameHe;
  const head = `<header class="head" dir="ltr"><span class="biz" dir="auto">${esc(name)}</span>${input.identity.logoDataUri ? `<img src="${esc(input.identity.logoDataUri)}" alt="">` : ''}</header>`;
  const html = `<!doctype html><html lang="${sections[0]?.lang ?? 'en'}"><head><meta charset="utf-8"><title>${esc(input.title)}</title><style>${styles(input.mode)}</style></head><body>${head}${bodies}${
    input.evidence ? evidenceHtml(input.evidence) : ''
  }</body></html>`;
  return { html, boxes: [...c.boxes.values()] };
}
