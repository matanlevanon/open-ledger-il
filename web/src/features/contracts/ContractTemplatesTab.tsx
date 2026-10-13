import { useState } from 'react';
import { BackLink } from '../../components/BackLink';
import { usePreferences } from '../../app/preferences';
import { useT } from '../../i18n';
import { btnPrimary, btnSecondary, ErrorNote, errorText, input, label, Loading, useLoad } from '../documents/ui';
import { type ChoiceOption, contractsApi, type FieldDef, type FieldKind, type Service, type ServiceInput, type Template, type TemplateInput } from './api';

const FIELD_KINDS: FieldKind[] = ['client', 'business', 'owner_input', 'signer_input', 'signature', 'signed_date', 'choice'];
const SOURCES: Record<string, string[]> = {
  client: ['name', 'name_en', 'name_he', 'tax_id', 'address', 'address_en', 'address_he', 'contact_name', 'contact_email', 'contact_phone', 'email'],
  business: ['name', 'name_en', 'name_he', 'legal_name', 'tax_id', 'address', 'address_en', 'address_he', 'email', 'phone', 'website'],
};
const INPUT_TYPES: Record<string, string[]> = { owner_input: ['text', 'multiline', 'money', 'date', 'number'], signer_input: ['name', 'role', 'text', 'date'] };

function blankField(n: number): FieldDef {
  return { key: `field_${n}`, labelEn: '', labelHe: '', kind: 'owner_input', required: false, inputType: 'text', options: [], multiple: false, allowOther: false };
}

/** "value|label" per line, a trailing * adds a free-text box. */
export function optionsToText(options: ChoiceOption[]): string {
  return options.map((o) => `${o.value}|${o.labelEn}${o.freeText ? '*' : ''}`).join('\n');
}

export function textToOptions(text: string, previous: ChoiceOption[]): ChoiceOption[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const freeText = line.endsWith('*');
      const [value, ...rest] = line.replace(/\*$/, '').split('|');
      const v = (value ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'option';
      const labelEn = rest.join('|').trim() || v;
      return { value: v, labelEn, labelHe: previous.find((p) => p.value === v)?.labelHe ?? '', freeText };
    });
}

function FieldRow({ field, onChange, onRemove }: { field: FieldDef; onChange: (f: FieldDef) => void; onRemove: () => void }) {
  const t = useT();
  const set = (p: Partial<FieldDef>) => onChange({ ...field, ...p });
  return (
    <div className="grid gap-2 rounded-md border border-line p-2 md:grid-cols-6" data-testid="field-row">
      <input aria-label={t('contracts.templates.key')} className={`${input} font-mono`} value={field.key} onChange={(e) => set({ key: e.target.value })} />
      <input aria-label={t('contracts.templates.labelEn')} placeholder={t('contracts.templates.labelEn')} className={input} value={field.labelEn} onChange={(e) => set({ labelEn: e.target.value })} />
      <input aria-label={t('contracts.templates.labelHe')} placeholder={t('contracts.templates.labelHe')} className={input} dir="rtl" value={field.labelHe} onChange={(e) => set({ labelHe: e.target.value })} />
      <select
        aria-label={t('contracts.templates.fieldKind')}
        className={input}
        value={field.kind}
        onChange={(e) => {
          const kind = e.target.value as FieldKind;
          set({
            kind,
            source: SOURCES[kind]?.[0] ?? null,
            inputType: INPUT_TYPES[kind]?.[0] ?? null,
            party: kind === 'signature' || kind === 'signed_date' ? 'client' : null,
          });
        }}
      >
        {FIELD_KINDS.map((k) => (
          <option key={k} value={k}>
            {t(`contracts.fieldKind.${k}`)}
          </option>
        ))}
      </select>
      {SOURCES[field.kind] && (
        <select aria-label={t('contracts.templates.source')} className={input} value={field.source ?? ''} onChange={(e) => set({ source: e.target.value })}>
          {SOURCES[field.kind]!.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
      {INPUT_TYPES[field.kind] && (
        <select aria-label={t('contracts.templates.inputType')} className={input} value={field.inputType ?? ''} onChange={(e) => set({ inputType: e.target.value })}>
          {INPUT_TYPES[field.kind]!.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
      {(field.kind === 'signature' || field.kind === 'signed_date') && (
        <select aria-label={t('contracts.templates.party')} className={input} value={field.party ?? 'client'} onChange={(e) => set({ party: e.target.value as 'owner' | 'client' })}>
          <option value="owner">{t('contracts.party.owner')}</option>
          <option value="client">{t('contracts.party.client')}</option>
        </select>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm md:col-span-6">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={field.required} onChange={(e) => set({ required: e.target.checked })} />
          {t('contracts.templates.required')}
        </label>
        {field.kind === 'owner_input' && (
          <input aria-label={t('contracts.templates.defaultValue')} placeholder={t('contracts.templates.defaultValue')} className={`${input} max-w-[12rem]`} value={field.defaultValue ?? ''} onChange={(e) => set({ defaultValue: e.target.value || null })} />
        )}
        {(field.kind === 'owner_input' || field.kind === 'choice') && (
          <label className="flex items-center gap-1">
            {t('contracts.templates.mapsTo')}
            <select className={`${input} w-auto`} value={field.mapsTo ?? ''} onChange={(e) => set({ mapsTo: (e.target.value || null) as FieldDef['mapsTo'] })}>
              <option value="">{t('contracts.templates.none')}</option>
              <option value="amount">amount</option>
              <option value="currency">currency</option>
              <option value="start_date">start_date</option>
              <option value="description">description</option>
            </select>
          </label>
        )}
        {field.kind === 'choice' && (
          <>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={field.binding === 'services'} onChange={(e) => set({ binding: e.target.checked ? 'services' : null, multiple: e.target.checked ? true : field.multiple })} />
              {t('contracts.templates.binding')}
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={field.multiple} onChange={(e) => set({ multiple: e.target.checked })} />
              {t('contracts.templates.multiple')}
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={field.allowOther} onChange={(e) => set({ allowOther: e.target.checked })} />
              {t('contracts.templates.allowOther')}
            </label>
          </>
        )}
        <button type="button" className="ms-auto text-sm text-danger hover:underline" onClick={onRemove}>
          {t('contracts.templates.removeField')}
        </button>
      </div>
      {field.kind === 'choice' && field.binding !== 'services' && (
        <label className="block md:col-span-6">
          <span className="text-xs text-muted">{t('contracts.templates.options')}</span>
          <textarea className={`${input} font-mono`} rows={3} defaultValue={optionsToText(field.options)} onBlur={(e) => set({ options: textToOptions(e.target.value, field.options) })} />
        </label>
      )}
    </div>
  );
}

function TemplateForm({ initial, onDone, onCancel }: { initial: Template | null; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [form, setForm] = useState<TemplateInput>(
    initial
      ? { name: initial.name, kind: initial.kind, bodyEn: initial.bodyEn, bodyHe: initial.bodyHe, fields: initial.fields, active: initial.active }
      : { name: '', kind: 'contract', bodyEn: '', bodyHe: '', fields: [], active: true },
  );
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      if (initial) await contractsApi.updateTemplate(initial.id, form);
      else await contractsApi.createTemplate(form);
      onDone();
    } catch (e) {
      setError(errorText(e, t));
    }
  };
  return (
    <div className="flex flex-col gap-3" data-testid="template-form">
      <BackLink onClick={onCancel} label={t('contracts.templates.back')} />
      <ErrorNote error={error} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block md:col-span-2">
          <span className={label}>{t('contracts.templates.name')}</span>
          <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="block">
          <span className={label}>{t('contracts.templates.kind')}</span>
          <select className={input} value={form.kind} disabled={Boolean(initial)} onChange={(e) => setForm({ ...form, kind: e.target.value as TemplateInput['kind'] })}>
            <option value="contract">{t('contracts.templates.kind.contract')}</option>
            <option value="work_order">{t('contracts.templates.kind.work_order')}</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-muted">{t('contracts.templates.bodyHint')}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className={label}>{t('contracts.templates.bodyEn')}</span>
          <textarea className={`${input} font-mono`} rows={14} dir="ltr" value={form.bodyEn} onChange={(e) => setForm({ ...form, bodyEn: e.target.value })} />
        </label>
        <label className="block">
          <span className={label}>{t('contracts.templates.bodyHe')}</span>
          <textarea className={`${input} font-mono`} rows={14} dir="rtl" value={form.bodyHe} onChange={(e) => setForm({ ...form, bodyHe: e.target.value })} />
        </label>
      </div>
      <div className="flex items-center justify-between">
        <span className={label}>{t('contracts.templates.fields')}</span>
        <button type="button" className={btnSecondary} onClick={() => setForm({ ...form, fields: [...form.fields, blankField(form.fields.length + 1)] })}>
          {t('contracts.templates.addField')}
        </button>
      </div>
      {form.fields.map((f, i) => (
        <FieldRow
          key={i}
          field={f}
          onChange={(nf) => setForm({ ...form, fields: form.fields.map((x, j) => (j === i ? nf : x)) })}
          onRemove={() => setForm({ ...form, fields: form.fields.filter((_, j) => j !== i) })}
        />
      ))}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
        {t('contracts.templates.active')}
      </label>
      {initial && <p className="text-xs text-muted">{t('contracts.templates.versionNote')}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnPrimary} onClick={() => void save()}>
          {t('contracts.templates.save')}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel}>
          {t('contracts.templates.cancel')}
        </button>
      </div>
    </div>
  );
}

function blankService(): ServiceInput {
  return { nameEn: '', nameHe: '', model: 'fixed_fee', modelLabelEn: null, modelLabelHe: null, descriptionEn: '', descriptionHe: '', sortOrder: 0, active: true, items: [] };
}

function toInput(s: Service): ServiceInput {
  return {
    nameEn: s.nameEn,
    nameHe: s.nameHe,
    model: s.model,
    modelLabelEn: s.modelLabelEn,
    modelLabelHe: s.modelLabelHe,
    descriptionEn: s.descriptionEn,
    descriptionHe: s.descriptionHe,
    sortOrder: s.sortOrder,
    active: s.active,
    items: s.items.map((i) => ({ id: i.id, labelEn: i.labelEn, labelHe: i.labelHe, active: i.active })),
  };
}

function ServiceForm({ initial, onSave, onCancel }: { initial: ServiceInput; onSave: (s: ServiceInput) => Promise<void>; onCancel: () => void }) {
  const t = useT();
  const [s, setS] = useState(initial);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-testid="service-form">
      <div className="grid gap-2 md:grid-cols-2">
        <input aria-label={t('contracts.services.nameEn')} placeholder={t('contracts.services.nameEn')} className={input} value={s.nameEn} onChange={(e) => setS({ ...s, nameEn: e.target.value })} />
        <input aria-label={t('contracts.services.nameHe')} placeholder={t('contracts.services.nameHe')} className={input} dir="rtl" value={s.nameHe} onChange={(e) => setS({ ...s, nameHe: e.target.value })} />
        <select aria-label={t('contracts.services.model')} className={input} value={s.model} onChange={(e) => setS({ ...s, model: e.target.value as ServiceInput['model'] })}>
          <option value="fixed_fee">{t('contracts.services.model.fixed_fee')}</option>
          <option value="monthly_retainer">{t('contracts.services.model.monthly_retainer')}</option>
          <option value="milestones">{t('contracts.services.model.milestones')}</option>
        </select>
        <input aria-label={t('contracts.services.modelLabel')} placeholder={t('contracts.services.modelLabel')} className={input} value={s.modelLabelEn ?? ''} onChange={(e) => setS({ ...s, modelLabelEn: e.target.value || null })} />
        <input aria-label={t('contracts.services.descriptionEn')} placeholder={t('contracts.services.descriptionEn')} className={input} value={s.descriptionEn} onChange={(e) => setS({ ...s, descriptionEn: e.target.value })} />
        <input aria-label={t('contracts.services.descriptionHe')} placeholder={t('contracts.services.descriptionHe')} className={input} dir="rtl" value={s.descriptionHe} onChange={(e) => setS({ ...s, descriptionHe: e.target.value })} />
      </div>
      <span className={label}>{t('contracts.services.items')}</span>
      {s.items.map((it, i) => (
        <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input aria-label={t('contracts.templates.labelEn')} className={input} value={it.labelEn} onChange={(e) => setS({ ...s, items: s.items.map((x, j) => (j === i ? { ...x, labelEn: e.target.value } : x)) })} />
          <input aria-label={t('contracts.templates.labelHe')} className={input} dir="rtl" value={it.labelHe} onChange={(e) => setS({ ...s, items: s.items.map((x, j) => (j === i ? { ...x, labelHe: e.target.value } : x)) })} />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={it.active} onChange={(e) => setS({ ...s, items: s.items.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)) })} />
            {t('contracts.services.active')}
          </label>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={() => setS({ ...s, items: [...s.items, { labelEn: '', labelHe: '', active: true }] })}>
          {t('contracts.services.addItem')}
        </button>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} />
          {t('contracts.services.active')}
        </label>
        <button type="button" className={btnPrimary} onClick={() => void onSave(s)}>
          {t('contracts.templates.save')}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel}>
          {t('contracts.templates.cancel')}
        </button>
      </div>
    </div>
  );
}

function ServicesSection() {
  const t = useT();
  const { locale } = usePreferences();
  const { data, error, setData } = useLoad(() => contractsApi.services(true), []);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  const save = (id: number | 'new') => async (s: ServiceInput) => {
    setSaveError(null);
    try {
      setData(id === 'new' ? await contractsApi.createService(s) : await contractsApi.updateService(id, s));
      setEditing(null);
    } catch (e) {
      setSaveError(errorText(e, t));
    }
  };
  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-lg text-ink">{t('contracts.services.title')}</h3>
        <button type="button" className={btnSecondary} onClick={() => setEditing('new')}>
          {t('contracts.services.add')}
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">{t('contracts.services.intro')}</p>
      <ErrorNote error={saveError} />
      {editing === 'new' && <ServiceForm initial={blankService()} onSave={save('new')} onCancel={() => setEditing(null)} />}
      <ul className="mt-3 flex flex-col gap-2">
        {data.services.map((s) =>
          editing === s.id ? (
            <li key={s.id}>
              <ServiceForm initial={toInput(s)} onSave={save(s.id)} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm ${s.active ? '' : 'opacity-60'}`}>
              <span>
                <bdi className="font-semibold">{locale === 'he' ? s.nameHe || s.nameEn : s.nameEn || s.nameHe}</bdi> · {locale === 'he' ? s.modelLabelHe : s.modelLabelEn} ·{' '}
                {t('contracts.services.itemCount', { n: s.items.filter((i) => i.active).length })}
              </span>
              <button type="button" className={btnSecondary} onClick={() => setEditing(s.id)}>
                {t('contracts.templates.edit')}
              </button>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/** R25, Screen E: Settings > Contract templates, per business. */
export function ContractTemplatesTab() {
  const t = useT();
  const { data, error, reload } = useLoad(() => contractsApi.templates(), []);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  const done = () => {
    setEditing(null);
    setNote(t('contracts.templates.saved'));
    reload();
  };
  const current = typeof editing === 'number' ? (data.templates.find((x) => x.id === editing) ?? null) : null;
  return (
    <div>
      {editing !== null ? (
        <TemplateForm key={String(editing)} initial={current} onDone={done} onCancel={() => setEditing(null)} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted">{t('contracts.templates.intro')}</span>
            <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
              {t('contracts.templates.new')}
            </button>
          </div>
          {note && (
            <p role="status" className="mt-2 text-sm text-muted">
              {note}
            </p>
          )}
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="py-2 text-start font-semibold">{t('contracts.templates.col.template')}</th>
                <th className="py-2 text-start font-semibold">{t('contracts.templates.col.fields')}</th>
                <th className="py-2 text-start font-semibold">{t('contracts.templates.col.used')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.templates.map((tpl) => (
                <tr key={tpl.id} className={`border-b border-line ${tpl.active ? '' : 'opacity-60'}`}>
                  <td className="py-2">
                    <bdi>{tpl.name}</bdi> <span className="text-xs text-muted">· {t(`contracts.templates.kind.${tpl.kind}`)} · v{tpl.version}</span>
                  </td>
                  <td className="py-2 ltr-nums">{tpl.fieldCount}</td>
                  <td className="py-2 ltr-nums">{tpl.usedCount}</td>
                  <td className="py-2 text-end">
                    <button type="button" className={btnSecondary} onClick={() => setEditing(tpl.id)}>
                      {t('contracts.templates.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">{t('contracts.templates.kinds')}</p>
        </>
      )}
      <ServicesSection />
    </div>
  );
}
