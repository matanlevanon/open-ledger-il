import type { Env } from '../../env';
import type { PdfEngine } from '../pdf/engine';
import { isDemo } from './config';

/**
 * R26: every PDF and every HTML preview in demo mode carries a diagonal watermark, in English and
 * Hebrew. It goes into the HTML before the browser lays it out, so Hebrew renders right to left.
 * position: fixed repeats it on every printed page.
 */

export const WATERMARK_TEXT_EN = 'DEMO · NOT A VALID TAX DOCUMENT';
export const WATERMARK_TEXT_HE = 'הדגמה · אינו מסמך מס תקף';

const MARKUP = `<div class="ledger-demo-watermark" aria-hidden="true"><span>${WATERMARK_TEXT_EN}</span><span dir="rtl" lang="he">${WATERMARK_TEXT_HE}</span></div>`;
const STYLE = `<style>.ledger-demo-watermark{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12mm;transform:rotate(-30deg);pointer-events:none;z-index:9999;color:rgba(200,30,30,.16);font:700 30pt sans-serif;white-space:nowrap}</style>`;

export function injectWatermark(html: string): string {
  if (html.includes('ledger-demo-watermark')) return html;
  const withStyle = html.includes('</head>') ? html.replace('</head>', `${STYLE}</head>`) : `${STYLE}${html}`;
  return withStyle.includes('</body>') ? withStyle.replace(/<\/body>(?![\s\S]*<\/body>)/, `${MARKUP}</body>`) : `${withStyle}${MARKUP}`;
}

/** The engine a module uses: in demo mode every page it renders carries the watermark. */
export function withDemoWatermark(engine: PdfEngine, env: Pick<Env, 'DEMO_MODE'>): PdfEngine {
  if (!isDemo(env)) return engine;
  return { renderPdf: (html: string) => engine.renderPdf(injectWatermark(html)) };
}
