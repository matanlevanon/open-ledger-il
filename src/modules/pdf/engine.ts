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
      // The HTML carries everything inline (fonts, logo, signature as data URIs), so the page needs
      // no network. 'load' plus the fonts promise is enough. 'networkidle0' waited for network
      // silence and timed out at 30 s on Browser Run (10 Nov 2026), so no PDF was made.
      await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
      await page.evaluate('document.fonts.ready.then(() => true)');
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
