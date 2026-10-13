import { degrees, PDFDocument, PDFString, rgb, StandardFonts } from 'pdf-lib';
import type { PdfEngine } from '../pdf/engine';
import { FIELD_LINK_PREFIX } from '../contracts/render';

/**
 * R26: a plain PDF engine for the sample set's contracts. The sample set loads in the reset
 * Worker, which has no browser. It lays the contract HTML out as plain text with pdf-lib, writes a
 * Link annotation for every field box (the same contract the browser engine keeps), and stamps
 * the demo watermark. pdf-lib draws Latin text only, so the sample contracts are in English.
 * Everything a visitor makes renders with the real engine.
 */

export const WATERMARK_EN = 'DEMO · NOT A VALID TAX DOCUMENT';

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const latin = (s: string) => s.replace(/[^\x20-\x7e·]/g, '?').replace(/·/g, '-');

export class TextPdfEngine implements PdfEngine {
  async renderPdf(html: string): Promise<ArrayBuffer> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const W = 595;
    const H = 842;
    const M = 50;
    let page = doc.addPage([W, H]);
    let x = M;
    let y = H - M;
    let size = 10;
    let isBold = false;
    let link: { href: string; x: number; y: number; sig: boolean } | null = null;

    const newline = (gap = 1.5) => {
      x = M;
      y -= size * gap;
      if (y < M + 20) {
        page = doc.addPage([W, H]);
        y = H - M;
      }
    };
    const word = (w: string) => {
      const f = isBold ? bold : font;
      const text = latin(w);
      const width = f.widthOfTextAtSize(`${text} `, size);
      if (x + width > W - M) newline();
      page.drawText(text, { x, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
      x += width;
    };
    const closeLink = () => {
      if (!link) return;
      const height = link.sig ? 44 : size + 4;
      if (link.sig) {
        if (x + 160 > W - M) newline();
        page.drawRectangle({ x, y: y - 34, width: 160, height, borderColor: rgb(0.6, 0.64, 0.69), borderWidth: 0.8 });
        const rect = [x, y - 34, x + 160, y - 34 + height];
        page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(link.href) } })));
        x += 166;
        y -= 30;
      } else {
        const x1 = link.y === y ? link.x : M;
        const rect = [x1, y - 3, Math.max(x, x1 + 30), y - 3 + height];
        page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(link.href) } })));
      }
      link = null;
    };

    const body = html.replace(/[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*/, '');
    for (const token of body.split(/(<[^>]+>)/)) {
      if (!token) continue;
      if (token.startsWith('<')) {
        const tag = /^<\/?([a-z0-9]+)/i.exec(token)?.[1]?.toLowerCase() ?? '';
        const closing = token.startsWith('</');
        if (tag === 'a' && !closing) {
          const href = /href="([^"]+)"/.exec(token)?.[1] ?? '';
          if (href.startsWith(FIELD_LINK_PREFIX)) link = { href: decode(href), x, y, sig: token.includes('f-sig') };
        } else if (tag === 'a' && closing) closeLink();
        else if (/^h[1-4]$/.test(tag)) {
          if (!closing) {
            newline(2);
            size = tag === 'h1' ? 15 : 12;
            isBold = true;
          } else {
            newline();
            size = 10;
            isBold = false;
          }
        } else if (tag === 'strong' || tag === 'b' || tag === 'th') isBold = !closing;
        else if (closing && ['p', 'li', 'tr', 'div', 'blockquote', 'section', 'header'].includes(tag)) newline();
        else if (tag === 'br') newline(1.3);
        else if (!closing && tag === 'td') x += 6;
        else if (!closing && tag === 'section' && token.includes('evidence')) {
          page = doc.addPage([W, H]);
          y = H - M;
          x = M;
        }
        continue;
      }
      for (const w of decode(token).split(/\s+/).filter(Boolean)) word(w);
    }
    for (const p of doc.getPages()) {
      p.drawText(latin(WATERMARK_EN), { x: 90, y: 260, size: 36, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(35) });
    }
    const bytes = await doc.save();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
}
