import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import type { PdfEngine } from '../pdf/engine';
import { FIELD_LINK_PREFIX } from './render';

/**
 * R25, tests only: a stand-in for Browser Rendering that returns a real PDF. Each field link in the
 * HTML becomes a Link annotation, stacked down the page, the way Chrome writes them. Text prints as
 * ASCII only (pdf-lib cannot shape Hebrew, which is why production never draws text with it).
 */
export class FakeContractPdfEngine implements PdfEngine {
  readonly renders: string[] = [];

  async renderPdf(html: string): Promise<ArrayBuffer> {
    this.renders.push(html);
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    let page = doc.addPage([595, 842]);
    let y = 790;
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? 'Contract';
    page.drawText(title.replace(/[^\x20-\x7e]/g, '?').slice(0, 80), { x: 40, y: 810, size: 11, font });
    for (const m of html.matchAll(/<a class="f ([^"]*)" dir="auto" href="([^"]+)"/g)) {
      const href = m[2]!;
      if (!href.startsWith(FIELD_LINK_PREFIX)) continue;
      const height = m[1]!.includes('f-sig') ? 50 : 14;
      if (y - height < 40) {
        page = doc.addPage([595, 842]);
        y = 800;
      }
      const link = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [60, y - height, 300, y],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(href) },
      });
      page.node.addAnnot(doc.context.register(link));
      y -= height + 8;
    }
    if (html.includes('class="evidence"')) {
      const evidence = doc.addPage([595, 842]);
      evidence.drawText('Evidence of signing', { x: 40, y: 800, size: 12, font });
    }
    doc.setTitle(title);
    doc.catalog.set(PDFName.of('Lang'), PDFString.of('en'));
    const bytes = await doc.save();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
}
