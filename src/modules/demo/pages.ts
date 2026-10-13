import type { Env } from '../../env';
import { demoTexts } from './config';

/** R26: the pages a visitor sees before the app: the gate (Screen A), the privacy notice, the code page. */

export type Lang = 'en' | 'he';

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function shell(lang: Lang, title: string, body: string, head = ''): string {
  return `<!doctype html><html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>${head}
<style>
:root{--canvas:#faf9f6;--surface:#fff;--ink:#1d1d1b;--muted:#6b6a66;--line:#e3e1db;--brand:#1f5fd1;--danger:#b42318}

*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.55 system-ui,"Segoe UI",sans-serif}
main{max-width:440px;margin:0 auto;padding:40px 16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px}
h1{font-size:24px;margin:0 0 6px}h2{font-size:18px;margin:20px 0 6px}.muted{color:var(--muted);font-size:14px}
label.f{display:block;font-size:13px;color:var(--muted);margin:14px 0 4px}
input[type=text],input[type=email]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--canvas);color:var(--ink);font:inherit}
.check{display:flex;gap:8px;align-items:flex-start;margin-top:14px;font-size:14px}.check input{margin-top:4px;width:18px;height:18px;flex:none}
button{width:100%;margin-top:16px;padding:12px;font:inherit;font-weight:600;border:0;border-radius:12px;background:var(--brand);color:#fff;cursor:pointer}
a{color:var(--brand)}.err{color:var(--danger);font-size:14px;margin:10px 0 0}.links{text-align:center;margin-top:12px}
.prose p,.prose li{font-size:15px}
</style></head><body><main>${body}</main></body></html>`;
}

const G = {
  en: {
    title: (p: string) => `Try ${p}`,
    lead: 'A full Ledger with sample clients, invoices and contracts. Create anything you like. Your copy resets every night at 03:00 Israel time.',
    name: 'Name',
    namePh: 'Your name',
    email: 'Email',
    emailPh: 'you@company.com',
    enter: 'Enter the demo',
    privacy: 'Privacy notice',
    other: 'עברית',
    noRealData: 'Do not enter real personal data in the demo.',
  },
  he: {
    title: (p: string) => `נסו את ${p}`,
    lead: 'Ledger מלא עם לקוחות, חשבוניות והסכמים לדוגמה. צרו כל מה שתרצו. העותק שלכם מתאפס כל לילה ב-03:00 שעון ישראל.',
    name: 'שם',
    namePh: 'השם שלך',
    email: 'אימייל',
    emailPh: 'you@company.com',
    enter: 'כניסה להדגמה',
    privacy: 'הודעת פרטיות',
    other: 'English',
    noRealData: 'אל תזינו בהדגמה מידע אישי אמיתי.',
  },
};

export function gatePageHtml(env: Env, lang: Lang, opts: { error?: string | null; name?: string; email?: string } = {}): string {
  const t = G[lang];
  const texts = demoTexts(env);
  const siteKey = (env.TURNSTILE_SITE_KEY ?? '').trim();
  const turnstile = siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-language="${lang}" style="margin-top:14px"></div>` : '';
  // The app opens in the language picked here.
  const remember = `<script>try{localStorage.setItem('open-ledger-il-locale','${lang}')}catch(e){}</script>`;
  const head = remember + (siteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : '');
  return shell(
    lang,
    t.title(texts.product),
    `<div class="card">
<h1>${esc(t.title(texts.product))}</h1>
<p class="muted">${esc(t.lead)}</p>
<form method="post" action="/api/demo/enter">
<input type="hidden" name="lang" value="${lang}">
<label class="f" for="name">${esc(t.name)}</label><input type="text" id="name" name="name" required maxlength="200" autocomplete="name" placeholder="${esc(t.namePh)}" value="${esc(opts.name ?? '')}">
<label class="f" for="email">${esc(t.email)}</label><input type="email" id="email" name="email" required maxlength="200" autocomplete="email" placeholder="${esc(t.emailPh)}" value="${esc(opts.email ?? '')}">
<label class="check"><input type="checkbox" name="consent" value="yes"><span>${esc(lang === 'he' ? texts.consentHe : texts.consentEn)}</span></label>
${turnstile}
${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ''}
<button type="submit">${esc(t.enter)}</button>
</form>
<p class="muted links">${esc(t.noRealData)}</p>
<p class="muted links"><a href="/privacy?lang=${lang}">${esc(t.privacy)}</a> · <a href="/?lang=${lang === 'he' ? 'en' : 'he'}">${esc(t.other)}</a></p>
</div>`,
    head,
  );
}

export function codePageHtml(lang: Lang, email: string, error?: string | null): string {
  const en = lang === 'en';
  return shell(
    lang,
    en ? 'Check your email' : 'בדקו את המייל',
    `<div class="card">
<h1>${en ? 'Welcome back' : 'ברוכים השבים'}</h1>
<p class="muted">${en ? `You opened the demo today already. We emailed a 6-digit code to ${esc(email)}. Type it to reopen your copy.` : `כבר פתחתם היום את ההדגמה. שלחנו קוד בן 6 ספרות אל ${esc(email)}. הקלידו אותו כדי לפתוח את העותק שלכם.`}</p>
<form method="post" action="/api/demo/verify">
<input type="hidden" name="lang" value="${lang}"><input type="hidden" name="email" value="${esc(email)}">
<label class="f" for="code">${en ? 'Code' : 'קוד'}</label><input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<button type="submit">${en ? 'Open my demo' : 'פתיחת ההדגמה שלי'}</button>
</form>
<p class="muted links"><a href="/?lang=${lang}">${en ? 'Start over' : 'מההתחלה'}</a></p>
</div>`,
  );
}

export function messagePageHtml(lang: Lang, title: string, body: string): string {
  return shell(lang, title, `<div class="card"><h1>${esc(title)}</h1><p>${esc(body)}</p><p class="links"><a href="/">${lang === 'he' ? 'לדף הפתיחה' : 'Back to the demo'}</a></p></div>`);
}

/** A privacy notice template. Plain: what is stored, why, for how long, and how to unsubscribe. */
export function privacyPageHtml(env: Env, lang: Lang): string {
  const t = demoTexts(env);
  const contact = (env.DEMO_PRIVACY_CONTACT ?? '').trim();
  if (lang === 'he') {
    return shell(
      'he',
      'הודעת פרטיות',
      `<div class="card prose"><h1>הודעת פרטיות</h1>
<p>ההדגמה של ${esc(t.product)} מופעלת על ידי ${esc(t.sender)}.</p>
<h2>מה נשמר</h2><ul><li>השם והאימייל שהזנתם בכניסה.</li><li>כתובת ה-IP, סוג הדפדפן ושעת הכניסה.</li><li>התשובה לתיבת העדכונים, נוסח התיבה ושעת התשובה, ואם אישרתם או הסרתם את עצמכם.</li><li>מה שיצרתם בתוך ההדגמה.</li></ul>
<h2>למה</h2><p>כדי לפתוח לכם עותק פרטי של ההדגמה, ולמנוע שימוש לרעה. עדכונים והצעות נשלחים רק אם סימנתם את התיבה ואישרתם במייל.</p>
<h2>לכמה זמן</h2><p>מה שיצרתם בהדגמה נמחק כל לילה ב-03:00. השם, האימייל ותיעוד ההסכמה נשמרים עד שתבקשו למחוק אותם.</p>
<h2>הסרה</h2><p>בכל מייל מאיתנו יש קישור הסרה.${contact ? ` אפשר גם לכתוב אל ${esc(contact)}.` : ''}</p>
<p class="links"><a href="/?lang=he">חזרה</a> · <a href="/privacy?lang=en">English</a></p></div>`,
    );
  }
  return shell(
    'en',
    'Privacy notice',
    `<div class="card prose"><h1>Privacy notice</h1>
<p>The ${esc(t.product)} demo is run by ${esc(t.sender)}.</p>
<h2>What we store</h2><ul><li>The name and email you type at the gate.</li><li>Your IP address, browser type and the time you entered.</li><li>Your answer to the updates box, the exact text of the box and the time, and whether you confirmed or unsubscribed.</li><li>What you create inside the demo.</li></ul>
<h2>Why</h2><p>To open a private copy of the demo for you and to stop abuse. Updates and offers go out only if you ticked the box and confirmed by email.</p>
<h2>For how long</h2><p>What you create in the demo is deleted every night at 03:00 Israel time. Your name, email and consent record stay until you ask us to delete them.</p>
<h2>Unsubscribe</h2><p>Every email from us has an unsubscribe link.${contact ? ` You can also write to ${esc(contact)}.` : ''}</p>
<p class="links"><a href="/?lang=en">Back</a> · <a href="/privacy?lang=he">עברית</a></p></div>`,
  );
}

export function misconfiguredPageHtml(): string {
  return shell('en', 'Demo misconfigured', '<div class="card"><h1>Demo misconfigured</h1><p>This demo is not available right now.</p></div>');
}
