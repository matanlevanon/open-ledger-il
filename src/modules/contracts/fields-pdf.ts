import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFPage,
} from 'pdf-lib';
import { FIELD_LINK_PREFIX, type FieldBox } from './render';

/**
 * R25: turns the field boxes of a rendered contract into AcroForm fields.
 *
 * The renderer wraps every field in a link to FIELD_LINK_PREFIX + name (render.ts). Chrome keeps
 * each link as a Link annotation with its page and rectangle. This step finds those links, deletes
 * them, and adds a named field at the same rectangle: a text field carrying the value, or a
 * signature field. The text itself is already on the page from the HTML render, so a text field
 * gets an empty appearance and never draws: pdf-lib never draws Hebrew.
 */

export interface PlaceOptions {
  /** True when the box locks (read-only). */
  lock: (box: FieldBox) => boolean;
  /** Signature images by field key, PNG or JPEG bytes. Drawn as the appearance of that signature field. */
  signatureImages?: Record<string, Uint8Array>;
}

export interface PlacedField {
  name: string;
  kind: 'text' | 'signature';
  page: number;
  rect: [number, number, number, number];
}

function uriOf(annot: PDFDict): string | null {
  const action = annot.lookup(PDFName.of('A'));
  if (!(action instanceof PDFDict)) return null;
  const uri = action.lookup(PDFName.of('URI'));
  if (uri instanceof PDFString || uri instanceof PDFHexString) return uri.decodeText();
  return null;
}

/** Every field link in the PDF, by name, removed from the pages. */
function takeFieldLinks(doc: PDFDocument): Map<string, { page: PDFPage; index: number; rect: [number, number, number, number] }[]> {
  const found = new Map<string, { page: PDFPage; index: number; rect: [number, number, number, number] }[]>();
  doc.getPages().forEach((page, index) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const ref = annots.get(i);
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      if (annot.lookup(PDFName.of('Subtype')) !== PDFName.of('Link')) continue;
      const uri = uriOf(annot);
      if (!uri || !uri.startsWith(FIELD_LINK_PREFIX)) continue;
      const rectArr = annot.lookup(PDFName.of('Rect'), PDFArray);
      const n = rectArr.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0));
      const rect: [number, number, number, number] = [Math.min(n[0]!, n[2]!), Math.min(n[1]!, n[3]!), Math.max(n[0]!, n[2]!), Math.max(n[1]!, n[3]!)];
      const name = decodeURIComponent(uri.slice(FIELD_LINK_PREFIX.length));
      const list = found.get(name) ?? [];
      list.unshift({ page, index, rect });
      found.set(name, list);
      annots.remove(i);
      const action = annot.get(PDFName.of('A'));
      if (action instanceof PDFRef) doc.context.delete(action);
      if (ref instanceof PDFRef) doc.context.delete(ref);
    }
  });
  return found;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

async function imageAppearance(doc: PDFDocument, bytes: Uint8Array, width: number, height: number): Promise<PDFRef> {
  const image = isPng(bytes) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const scale = Math.min(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const stream = doc.context.formXObject(
    [pushGraphicsState(), concatTransformationMatrix(w, 0, 0, h, (width - w) / 2, (height - h) / 2), drawObject('Im0'), popGraphicsState()],
    { BBox: [0, 0, width, height], Resources: { XObject: { Im0: image.ref } } },
  );
  return doc.context.register(stream);
}

/** Adds a field for every box. Returns the new PDF bytes and what was placed where. */
export async function placeFields(pdf: Uint8Array, boxes: FieldBox[], options: PlaceOptions): Promise<{ bytes: Uint8Array; placed: PlacedField[] }> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const links = takeFieldLinks(doc);
  const form = doc.getForm();
  const placed: PlacedField[] = [];
  const pageIndex = (page: PDFPage) => doc.getPages().indexOf(page);

  for (const box of boxes) {
    const spots = links.get(box.name);
    if (!spots || spots.length === 0) continue;
    if (box.kind === 'text') {
      const field = form.createTextField(box.name);
      if (box.value.includes('\n')) field.enableMultiline();
      for (const spot of spots) {
        const [x1, y1, x2, y2] = spot.rect;
        field.addToPage(spot.page, { x: x1, y: y1, width: x2 - x1, height: y2 - y1, borderWidth: 0, borderColor: undefined, backgroundColor: undefined });
        placed.push({ name: box.name, kind: 'text', page: pageIndex(spot.page), rect: spot.rect });
      }
      // The value is stored as UTF-16, so Hebrew survives. The page already shows it.
      if (box.value) field.acroField.setValue(PDFHexString.fromText(box.value));
      if (options.lock(box)) field.enableReadOnly();
      continue;
    }
    // Signature field: one field, one widget per place it prints.
    const fieldDict = doc.context.obj({ FT: 'Sig', T: PDFString.of(box.name), Kids: [] });
    if (options.lock(box)) fieldDict.set(PDFName.of('Ff'), PDFNumber.of(1));
    const fieldRef = doc.context.register(fieldDict);
    const kids = fieldDict.lookup(PDFName.of('Kids'), PDFArray);
    const image = options.signatureImages?.[box.key];
    for (const spot of spots) {
      const [x1, y1, x2, y2] = spot.rect;
      const widget = doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [x1, y1, x2, y2], F: 4, P: spot.page.ref, Parent: fieldRef });
      if (image) widget.set(PDFName.of('AP'), doc.context.obj({ N: await imageAppearance(doc, image, x2 - x1, y2 - y1) }));
      const widgetRef = doc.context.register(widget);
      kids.push(widgetRef);
      spot.page.node.addAnnot(widgetRef);
      placed.push({ name: box.name, kind: 'signature', page: pageIndex(spot.page), rect: spot.rect });
    }
    form.acroForm.addField(fieldRef);
  }
  // Values are drawn by the page. Readers must not draw them again over it.
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), doc.context.obj(false));
  const bytes = await doc.save({ updateFieldAppearances: false, useObjectStreams: false });
  return { bytes, placed };
}

export interface ReadField {
  name: string;
  type: 'text' | 'signature' | 'other';
  value: string;
  readOnly: boolean;
  widgets: number;
  hasAppearance: boolean;
}

/** Reads every AcroForm field back. For tests, and for the checks after signing. */
export async function readFields(pdf: Uint8Array): Promise<ReadField[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const out: ReadField[] = [];
  for (const [field] of doc.catalog.getOrCreateAcroForm().getAllFields()) {
    const dict = field.dict;
    const ft = dict.lookup(PDFName.of('FT'));
    const t = dict.lookup(PDFName.of('T'));
    const v = dict.lookup(PDFName.of('V'));
    const ff = dict.lookup(PDFName.of('Ff'));
    const kids = dict.lookup(PDFName.of('Kids'));
    const widgets = kids instanceof PDFArray ? kids.asArray().map((k) => doc.context.lookup(k) as PDFDict) : [dict];
    out.push({
      name: t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : '',
      type: ft === PDFName.of('Tx') ? 'text' : ft === PDFName.of('Sig') ? 'signature' : 'other',
      value: v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '',
      readOnly: ff instanceof PDFNumber ? (ff.asNumber() & 1) === 1 : false,
      widgets: widgets.length,
      hasAppearance: widgets.some((w) => w?.lookup(PDFName.of('AP')) instanceof PDFDict),
    });
  }
  return out;
}
