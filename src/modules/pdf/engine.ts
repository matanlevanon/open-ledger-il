import { type BrowserWorker, launch } from '@cloudflare/puppeteer';

/**
 * Turns rendered HTML into PDF bytes. `BrowserRenderingPdfEngine` drives Cloudflare Browser
 * Rendering. `FakePdfEngine` returns the HTML itself as bytes, so tests exercise the storage and
 * hashing path without a real browser (R02 rule: no test calls the internet).
 */
export interface PdfEngine {
  renderPdf(html: string): Promise<ArrayBuffer>;
}

export class BrowserRenderingPdfEngine implements PdfEngine {
  constructor(private readonly browser: BrowserWorker) {}

  async renderPdf(html: string): Promise<ArrayBuffer> {
    const browser = await launch(this.browser);
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const stream = await page.createPDFStream({ format: 'A4', printBackground: true });
      return await new Response(stream).arrayBuffer();
    } finally {
      await browser.close();
    }
  }
}

export class FakePdfEngine implements PdfEngine {
  async renderPdf(html: string): Promise<ArrayBuffer> {
    return new TextEncoder().encode(html).buffer as ArrayBuffer;
  }
}
