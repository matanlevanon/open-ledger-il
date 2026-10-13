import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
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

interface FieldLink {
  page: PDFPage;
  index: number;
  rect: [number, number, number, number];
  /** The Link annotation's own reference. Chrome's tagged PDF points at it from the structure tree. */
  ref: PDFRef | null;
  /** Its /StructParent key in the structure tree's ParentTree, if tagged. */
  structParent: PDFNumber | null;
}

/**
 * Every field link in the PDF, by name, removed from the pages. The annotation objects stay in the
 * file: Chrome's tagged PDF refers to each one from a structure element (OBJR), and deleting them
 * left dangling references. Adobe Reader repairs those on open and then reports a certified
 * contract as changed after signing.
 */
function takeFieldLinks(doc: PDFDocument): Map<string, FieldLink[]> {
  const found = new Map<string, FieldLink[]>();
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
      const sp = annot.lookup(PDFName.of('StructParent'));
      list.unshift({ page, index, rect, ref: ref instanceof PDFRef ? ref : null, structParent: sp instanceof PDFNumber ? sp : null });
      found.set(name, list);
      annots.remove(i);
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

/**
 * Chrome tags the PDF: each field link is an OBJR in a /Link structure element. The widget now sits
 * where the link was, so every OBJR that named the link names the widget instead, and the tagged
 * structure stays whole.
 */
function repointStructure(doc: PDFDocument, swap: Map<PDFRef, PDFRef>): void {
  if (swap.size === 0) return;
  const seen = new Set<unknown>();
  const walk = (obj: unknown): void => {
    if (seen.has(obj)) return;
    seen.add(obj);
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) walk(obj.get(i));
    } else if (obj instanceof PDFDict) {
      if (obj.get(PDFName.of('Type')) === PDFName.of('OBJR')) {
        const target = obj.get(PDFName.of('Obj'));
        const to = target instanceof PDFRef ? swap.get(target) : undefined;
        if (to) obj.set(PDFName.of('Obj'), to);
        return;
      }
      for (const [, v] of obj.entries()) walk(v);
    }
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) walk(obj);
}

/** Adds a field for every box. Returns the new PDF bytes and what was placed where. */
export async function placeFields(pdf: Uint8Array, boxes: FieldBox[], options: PlaceOptions): Promise<{ bytes: Uint8Array; placed: PlacedField[] }> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const links = takeFieldLinks(doc);
  const form = doc.getForm();
  const placed: PlacedField[] = [];
  const pageIndex = (page: PDFPage) => doc.getPages().indexOf(page);
  // Link annotation -> the widget that replaces it, so the structure tree can point at the widget.
  const swap = new Map<PDFRef, PDFRef>();
  const adopt = (spot: FieldLink, widgetRef: PDFRef | undefined) => {
    if (!widgetRef || !spot.ref) return;
    swap.set(spot.ref, widgetRef);
    if (spot.structParent) doc.context.lookup(widgetRef, PDFDict).set(PDFName.of('StructParent'), spot.structParent);
  };

  for (const box of boxes) {
    const spots = links.get(box.name);
    if (!spots || spots.length === 0) continue;
    if (box.kind === 'text') {
      const field = form.createTextField(box.name);
      if (box.value.includes('\n')) field.enableMultiline();
      for (const spot of spots) {
        const [x1, y1, x2, y2] = spot.rect;
        field.addToPage(spot.page, { x: x1, y: y1, width: x2 - x1, height: y2 - y1, borderWidth: 0, borderColor: undefined, backgroundColor: undefined });
        const widgets = field.acroField.getWidgets();
        adopt(spot, doc.context.getObjectRef(widgets[widgets.length - 1]!.dict));
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
      adopt(spot, widgetRef);
      kids.push(widgetRef);
      spot.page.node.addAnnot(widgetRef);
      placed.push({ name: box.name, kind: 'signature', page: pageIndex(spot.page), rect: spot.rect });
    }
    form.acroForm.addField(fieldRef);
  }
  repointStructure(doc, swap);
  // Values are drawn by the page. Readers must not draw them again over it. Absent means false.
  // The key is left out on purpose: with /NeedAppearances present, even false, Adobe Reader treats
  // a certified PDF as changed after signing and marks the certification invalid.
  form.acroForm.dict.delete(PDFName.of('NeedAppearances'));
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

/**
 * The copy a signer views before signing: a "Sign" button drawn in each of the given signature
 * fields, with a link to the signing page. Only for viewing. The stored sent PDF never changes, and
 * the signed PDF is built from the stored copy, so no button and no link reach the signed file.
 */
export async function addSignButtons(pdf: Uint8Array, fieldNames: string[], url: string, label = 'Sign'): Promise<Uint8Array> {
  if (fieldNames.length === 0) return pdf;
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  let added = 0;
  for (const [field] of doc.catalog.getOrCreateAcroForm().getAllFields()) {
    const dict = field.dict;
    if (dict.lookup(PDFName.of('FT')) !== PDFName.of('Sig')) continue;
    const t = dict.lookup(PDFName.of('T'));
    const name = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : '';
    if (!fieldNames.includes(name)) continue;
    const kids = dict.lookup(PDFName.of('Kids'));
    const widgets = kids instanceof PDFArray ? kids.asArray().map((k) => doc.context.lookup(k) as PDFDict) : [dict];
    for (const widget of widgets) {
      if (!widget || widget.lookup(PDFName.of('AP')) instanceof PDFDict) continue; // already signed
      const page = pages.find((p) => p.ref === widget.get(PDFName.of('P')));
      const rectArr = widget.lookup(PDFName.of('Rect'));
      if (!page || !(rectArr instanceof PDFArray)) continue;
      const n = rectArr.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0));
      const [x1, y1, x2, y2] = [Math.min(n[0]!, n[2]!), Math.min(n[1]!, n[3]!), Math.max(n[0]!, n[2]!), Math.max(n[1]!, n[3]!)];
      const boxH = y2 - y1;
      const size = Math.max(9, Math.min(16, boxH * 0.4));
      const textW = font.widthOfTextAtSize(label, size);
      const w = Math.min(x2 - x1 - 8, Math.max(textW + 28, 80));
      const h = Math.min(boxH - 8, size * 2.2);
      const bx = x1 + (x2 - x1 - w) / 2;
      const by = y1 + (boxH - h) / 2;
      page.drawRectangle({ x: bx, y: by, width: w, height: h, color: rgb(0.122, 0.373, 0.82), borderWidth: 0 });
      page.drawText(label, { x: bx + (w - textW) / 2, y: by + (h - size * 0.7) / 2, size, font, color: rgb(1, 1, 1) });
      const link = doc.context.register(
        doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x1, y1, x2, y2], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } }),
      );
      page.node.addAnnot(link);
      // Phone viewers paint an empty signature widget as a blank box over the page, which hid the
      // button and caught the tap. In this viewing copy the widget is hidden. The stored PDF keeps it.
      widget.set(PDFName.of('F'), PDFNumber.of(2));
      added++;
    }
  }
  if (added === 0) return pdf;
  return doc.save({ updateFieldAppearances: false, useObjectStreams: false });
}
