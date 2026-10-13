import { escapeHtml as esc } from './markdown';
import type { FieldDef, TemplateKind } from './types';

/** R25, Screen C: the signing page the client opens from the link. No account, no app. */

export type PageLang = 'en' | 'he';

const T = {
  en: {
    sentYou: { contract: 'sent you a contract to sign', work_order: 'sent you a work order to sign' },
    readAll: 'Read the whole document before you sign.',
    download: 'Download PDF',
    yourDetails: 'Your details',
    code: 'Code sent to',
    sendCode: 'Email me a code',
    resend: 'Send a new code',
    codeSent: 'We emailed a 6-digit code. It works for 15 minutes. Not there? Check spam, it can take a few minutes. Any code from the last 15 minutes works.',
    codePlaceholder: '6 digits',
    linkOnly: 'This link alone confirms who you are.',
    signature: 'Signature',
    draw: 'Draw',
    type: 'Type',
    drawHere: 'Draw here with your finger',
    clear: 'Clear',
    typeName: 'Type your name',
    consent: { contract: 'I have read the contract and I agree to sign it electronically.', work_order: 'I have read the work order and I agree to sign it electronically.' },
    sign: 'Sign',
    signing: 'Signing…',
    decline: 'Decline',
    declineReason: 'Reason (optional)',
    declineConfirm: 'Decline the document',
    cancel: 'Cancel',
    other: 'עברית',
    signedTitle: 'Signed',
    signedBody: 'Thank you. The document is signed. A copy is on its way to your email.',
    signedBodyNoEmail: 'Thank you. The document is signed. Download your copy below.',
    signedOn: 'Signed on',
    downloadSigned: 'Download signed PDF',
    declinedTitle: 'Declined',
    declinedBody: 'You declined this document. The sender was told.',
    unavailable: 'Link unavailable',
    askSender: 'Ask the sender for a new link.',
    needSignature: 'Draw or type your signature.',
    needConsent: 'Tick the box to agree to sign electronically.',
    simple: 'A simple electronic signature with an evidence trail: time, IP address, device and document hashes.',
  },
  he: {
    sentYou: { contract: 'שלח לך הסכם לחתימה', work_order: 'שלח לך הזמנת עבודה לחתימה' },
    readAll: 'קראו את כל המסמך לפני החתימה.',
    download: 'הורדת PDF',
    yourDetails: 'הפרטים שלך',
    code: 'קוד נשלח אל',
    sendCode: 'שלחו לי קוד במייל',
    resend: 'שלחו קוד חדש',
    codeSent: 'שלחנו קוד בן 6 ספרות. הוא תקף ל-15 דקות. לא הגיע? בדקו בספאם, זה יכול לקחת כמה דקות. כל קוד מ-15 הדקות האחרונות תקף.',
    codePlaceholder: '6 ספרות',
    linkOnly: 'הקישור עצמו מאשר מי את/ה.',
    signature: 'חתימה',
    draw: 'ציור',
    type: 'הקלדה',
    drawHere: 'חתמו כאן באצבע',
    clear: 'ניקוי',
    typeName: 'הקלידו את שמכם',
    consent: { contract: 'קראתי את ההסכם ואני מסכים/ה לחתום עליו באופן אלקטרוני.', work_order: 'קראתי את הזמנת העבודה ואני מסכים/ה לחתום עליה באופן אלקטרוני.' },
    sign: 'חתימה',
    signing: 'חותם…',
    decline: 'דחייה',
    declineReason: 'סיבה (לא חובה)',
    declineConfirm: 'דחיית המסמך',
    cancel: 'ביטול',
    other: 'English',
    signedTitle: 'נחתם',
    signedBody: 'תודה. המסמך נחתם. עותק בדרך למייל שלך.',
    signedBodyNoEmail: 'תודה. המסמך נחתם. הורידו את העותק שלכם כאן.',
    signedOn: 'נחתם ב-',
    downloadSigned: 'הורדת ה-PDF החתום',
    declinedTitle: 'נדחה',
    declinedBody: 'דחית את המסמך. השולח קיבל הודעה.',
    unavailable: 'הקישור אינו זמין',
    askSender: 'בקשו מהשולח קישור חדש.',
    needSignature: 'ציירו או הקלידו את החתימה.',
    needConsent: 'סמנו את התיבה כדי להסכים לחתימה אלקטרונית.',
    simple: 'חתימה אלקטרונית פשוטה עם תיעוד: שעה, כתובת IP, מכשיר וגיבוב המסמך.',
  },
} as const;

function shell(lang: PageLang, title: string, body: string, fontBase: string | null, script = ''): string {
  return `<!doctype html><html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light"><title>${esc(title)}</title>
<style>
${fontBase ? `@font-face { font-family: 'Dancing Script'; src: url(${fontBase}dancing.woff2) format('woff2'); font-display: block; }
@font-face { font-family: 'Amatic SC'; src: url(${fontBase}amatic-he.woff2) format('woff2'); font-display: block; }` : ''}
:root { color-scheme:light; --canvas:#faf9f6; --surface:#fff; --ink:#1d1d1b; --muted:#6b6a66; --line:#e3e1db; --brand:#1f5fd1; --ok:#1f8a4c; --danger:#b42318; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--canvas); color: var(--ink); font: 16px/1.5 system-ui, "Segoe UI", sans-serif; }
main { max-width: 440px; margin: 0 auto; padding: 16px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 16px; }
.muted { color: var(--muted); font-size: 14px; }
h1 { font-size: 20px; margin: 0; } h2 { font-size: 18px; margin: 0 0 8px; }
iframe.doc { width: 100%; height: 70vh; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
label.f { display: block; font-size: 13px; color: var(--muted); margin: 12px 0 4px; }
input[type=text], input[type=date], input[type=email], textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--canvas); color: var(--ink); font: inherit; }
.tabs { display: flex; gap: 6px; margin: 4px 0 8px; }
.tabs button { font: inherit; font-size: 14px; padding: 6px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); }
.tabs button[aria-selected=true] { background: var(--brand); border-color: var(--brand); color: #fff; }
.pad { position: relative; border: 2px dashed var(--brand); border-radius: 10px; background: #fff; height: 150px; touch-action: none; }
.pad canvas { width: 100%; height: 100%; display: block; border-radius: 8px; }
.pad .hint { position: absolute; inset: 0; display: grid; place-items: center; color: var(--brand); font-size: 14px; pointer-events: none; }
button.primary { width: 100%; margin-top: 12px; padding: 12px; font: inherit; font-weight: 600; border: 0; border-radius: 12px; background: var(--brand); color: #fff; }
button.primary:disabled { background: #c9c8c3; color: #fff; cursor: not-allowed; }
button.secondary { flex: none; padding: 10px 14px; font: inherit; font-size: 14px; font-weight: 600; border: 1px solid var(--brand); border-radius: 10px; background: var(--surface); color: var(--brand); cursor: pointer; white-space: nowrap; }
button.secondary:disabled { opacity: .5; cursor: default; }
button.link, a.link { background: none; border: 0; color: var(--brand); font: inherit; font-size: 14px; padding: 4px; text-decoration: underline; cursor: pointer; }
.check { display: flex; gap: 8px; align-items: flex-start; margin-top: 14px; font-size: 14px; }
.check input { margin-top: 4px; width: 18px; height: 18px; flex: none; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; margin-top: 10px; }
.err { color: var(--danger); font-size: 14px; margin-top: 8px; min-height: 1em; }
.ok { color: var(--ok); }
.hidden { display: none; }
@media (min-width: 960px) {
  main { max-width: 1440px; padding: 24px; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 0 28px; align-items: start; padding: 24px; }
  .head { grid-column: 1 / -1; }
  iframe.doc { height: calc(100vh - 190px); min-height: 560px; }
  .formpane { position: sticky; top: 24px; max-height: calc(100vh - 48px); overflow-y: auto; padding-inline-end: 4px; }
  .formpane > #sign-form > h2:first-child { margin-top: 0 !important; }
}
</style></head><body><main>${body}</main>${script}</body></html>`;
}

export interface SigningPageInput {
  lang: PageLang;
  base: string;
  sender: string;
  title: string;
  kind: TemplateKind;
  signerEmail: string;
  signerName: string;
  fields: FieldDef[];
  codeRequired: boolean;
  today: string;
}

function signerInputs(input: SigningPageInput): string {
  const t = T[input.lang];
  const rows = input.fields
    .filter((f) => f.kind === 'signer_input')
    .map((f) => {
      const label = (input.lang === 'he' ? f.labelHe || f.labelEn : f.labelEn || f.labelHe) || f.key;
      const type = f.inputType === 'date' ? 'date' : 'text';
      const value = f.inputType === 'name' ? input.signerName : f.inputType === 'date' ? input.today : '';
      return `<label class="f" for="in-${esc(f.key)}">${esc(label)}${f.required ? ' *' : ''}</label><input type="${type}" id="in-${esc(f.key)}" data-key="${esc(f.key)}" value="${esc(value)}" dir="auto" autocomplete="${f.inputType === 'name' ? 'name' : f.inputType === 'role' ? 'organization-title' : 'off'}">`;
    });
  return rows.length ? `<h2 style="margin-top:16px">${esc(t.yourDetails)}</h2>${rows.join('')}` : '';
}

export function signingPageHtml(input: SigningPageInput): string {
  const t = T[input.lang];
  const otherLang = input.lang === 'he' ? 'en' : 'he';
  const code = input.codeRequired
    ? `<label class="f" for="code">${esc(t.code)} ${esc(input.signerEmail)}</label>
<div style="display:flex;gap:8px"><input type="text" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="${esc(t.codePlaceholder)}" style="flex:1"><button type="button" class="secondary" id="send-code">${esc(t.sendCode)}</button></div>
<p class="muted hidden" id="code-sent" style="margin:6px 0 0">${esc(t.codeSent)}</p>
<button type="button" class="link hidden" id="resend-code" style="padding:4px 0">${esc(t.resend)}</button>`
    : `<p class="muted">${esc(t.linkOnly)}</p>`;
  const body = `<div class="card layout">
<div class="head"><h1 dir="auto">${esc(input.sender)}</h1><p class="muted" style="margin:2px 0 12px">${esc(t.sentYou[input.kind])}</p>
<p dir="auto" style="margin:0 0 8px;font-weight:600">${esc(input.title)}</p></div>
<div class="docpane"><iframe class="doc" src="${esc(input.base)}/view" title="${esc(input.title)}"></iframe>
<p class="muted">${esc(t.readAll)} <a class="link" href="${esc(input.base)}/pdf?download=1">${esc(t.download)}</a></p></div>
<div class="formpane"><div id="sign-form">
${signerInputs(input)}
${code}
<label class="f" id="signature">${esc(t.signature)}</label>
<div class="tabs" role="tablist"><button type="button" role="tab" aria-selected="true" id="tab-draw">${esc(t.draw)}</button><button type="button" role="tab" aria-selected="false" id="tab-type">${esc(t.type)}</button></div>
<div class="pad" id="pad"><canvas id="canvas"></canvas><span class="hint" id="hint">${esc(t.drawHere)}</span></div>
<input type="text" id="typed" class="hidden" placeholder="${esc(t.typeName)}" dir="auto" style="margin-top:8px" value="${esc(input.signerName)}">
<div class="row" style="justify-content:flex-end;margin-top:4px"><button type="button" class="link" id="clear">${esc(t.clear)}</button></div>
<label class="check"><input type="checkbox" id="consent"><span>${esc(t.consent[input.kind])}</span></label>
<button type="button" class="primary" id="sign" disabled>${esc(t.sign)}</button>
<p class="err" id="err" role="alert"></p>
<div class="row"><button type="button" class="link" id="decline-open">${esc(t.decline)}</button><span class="muted">·</span><a class="link" href="${esc(input.base)}/pdf?download=1">${esc(t.download)}</a><span class="muted">·</span><a class="link" href="?lang=${otherLang}">${esc(t.other)}</a></div>
<div id="decline" class="hidden"><label class="f" for="reason">${esc(t.declineReason)}</label><textarea id="reason" rows="3" dir="auto"></textarea>
<div class="row"><button type="button" class="link" id="decline-cancel">${esc(t.cancel)}</button><button type="button" class="link" id="decline-send" style="color:var(--danger)">${esc(t.declineConfirm)}</button></div></div>
<p class="muted" style="margin-top:14px">${esc(t.simple)}</p>
</div>
<div id="done" class="hidden"><h2 class="ok">${esc(t.signedTitle)}</h2><p id="done-body"></p><a class="link" href="${esc(input.base)}/pdf?download=1">${esc(t.downloadSigned)}</a></div>
<div id="declined" class="hidden"><h2>${esc(t.declinedTitle)}</h2><p>${esc(t.declinedBody)}</p></div>
</div></div>`;
  const strings = JSON.stringify({
    needSignature: t.needSignature,
    needConsent: t.needConsent,
    signing: t.signing,
    sign: t.sign,
    resend: t.resend,
    demoCode: input.lang === 'he' ? 'הדגמה: הקוד שלך הוא' : 'Demo: your code is',
    signedBody: input.codeRequired ? t.signedBody : t.signedBodyNoEmail,
  }).replace(/</g, '\\u003c');
  const script = `<script>
(function () {
  var S = ${strings};
  var base = ${JSON.stringify(input.base).replace(/</g, '\\u003c')};
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('canvas'), pad = $('pad'), ctx = canvas.getContext('2d');
  var mode = 'draw', drawn = false, drawing = false;
  function size() {
    var r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    var w = Math.round(r.width * d), h = Math.round(r.height * d);
    // A phone keyboard opening fires resize. Setting width or height clears the canvas, so a drawn
    // signature was lost while the page still thought one was there. Keep it, and skip a no-op.
    if (w !== canvas.width || h !== canvas.height) {
      var keep = null;
      if (drawn && mode === 'draw' && canvas.width && canvas.height) { keep = document.createElement('canvas'); keep.width = canvas.width; keep.height = canvas.height; keep.getContext('2d').drawImage(canvas, 0, 0); }
      canvas.width = w; canvas.height = h;
      if (keep) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(keep, 0, 0, w, h); }
    }
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#13213f';
    if (mode === 'type') typed();
  }
  function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener('pointerdown', function (e) { if (mode !== 'draw') return; drawing = true; canvas.setPointerCapture(e.pointerId); var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); $('hint').style.display = 'none'; });
  canvas.addEventListener('pointermove', function (e) { if (!drawing) return; var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); drawn = true; });
  canvas.addEventListener('pointerup', function () { drawing = false; });
  function blank() {
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (var i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
    return true;
  }
  function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); drawn = false; $('hint').style.display = mode === 'draw' ? '' : 'none'; if (mode === 'type') typed(); }
  function typed() {
    var r = canvas.getBoundingClientRect(); ctx.clearRect(0, 0, canvas.width, canvas.height);
    var text = $('typed').value.trim(); drawn = text.length > 0; if (!drawn) return;
    var sizePx = 48; ctx.fillStyle = '#13213f'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.direction = 'auto';
    do { ctx.font = sizePx + "px 'Dancing Script', 'Amatic SC', cursive"; sizePx -= 2; } while (ctx.measureText(text).width > r.width - 24 && sizePx > 14);
    ctx.fillText(text, r.width / 2, r.height / 2);
  }
  function setMode(m) {
    mode = m; $('tab-draw').setAttribute('aria-selected', m === 'draw'); $('tab-type').setAttribute('aria-selected', m === 'type');
    $('typed').classList.toggle('hidden', m !== 'type'); clear();
    if (m === 'type' && document.fonts) document.fonts.load("48px 'Dancing Script'").then(typed, typed);
  }
  $('tab-draw').onclick = function () { setMode('draw'); };
  $('tab-type').onclick = function () { setMode('type'); };
  $('typed').oninput = typed;
  $('clear').onclick = clear;
  window.addEventListener('resize', size); size();
  function post(path, body) {
    return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j && j.error && j.error.message) || 'Something went wrong.'); return j; }); });
  }
  var err = $('err');
  var sendCode = $('send-code');
  var resend = $('resend-code');
  function askCode(btn) {
    err.textContent = ''; btn.disabled = true;
    post('/code').then(function (j) {
      var el = $('code-sent'); if (j && j.demoCode) el.textContent = S.demoCode + ' ' + j.demoCode;
      sendCode.classList.add('hidden'); el.classList.remove('hidden'); resend.classList.remove('hidden');
      if (codeBox) codeBox.focus();
    }).catch(function (e) { err.textContent = e.message; }).then(function () { btn.disabled = false; });
  }
  if (sendCode) sendCode.onclick = function () { askCode(sendCode); };
  if (resend) resend.onclick = function () { askCode(resend); };
  var codeBox = $('code');
  function ready() { return $('consent').checked && (!codeBox || /^[0-9]{6}$/.test(codeBox.value.replace(/ /g, ''))); }
  function update() { $('sign').disabled = !ready(); }
  $('consent').addEventListener('change', update);
  if (codeBox) codeBox.addEventListener('input', update);
  update();
  $('sign').onclick = function () {
    if (!ready()) return;
    err.textContent = '';
    if (!drawn || blank()) { drawn = false; clear(); err.textContent = S.needSignature; return; }
    if (!$('consent').checked) { err.textContent = S.needConsent; return; }
    var values = {}; var inputs = document.querySelectorAll('[data-key]');
    for (var i = 0; i < inputs.length; i++) values[inputs[i].getAttribute('data-key')] = inputs[i].value;
    var btn = $('sign'); btn.disabled = true; btn.textContent = S.signing;
    post('/sign', { values: values, code: $('code') ? $('code').value : null, signaturePng: canvas.toDataURL('image/png'), consent: true })
      .then(function () { $('sign-form').classList.add('hidden'); $('done').classList.remove('hidden'); $('done-body').textContent = S.signedBody; })
      .catch(function (e) { err.textContent = e.message; btn.textContent = S.sign; update(); });
  };
  $('decline-open').onclick = function () { $('decline').classList.remove('hidden'); };
  $('decline-cancel').onclick = function () { $('decline').classList.add('hidden'); };
  $('decline-send').onclick = function () {
    post('/decline', { reason: $('reason').value }).then(function () { $('sign-form').classList.add('hidden'); $('declined').classList.remove('hidden'); }).catch(function (e) { err.textContent = e.message; });
  };
})();
</script>`;
  return shell(input.lang, input.title, body, `${input.base.replace(/\/c\/[^/]+$/, '/c/')}font/`, script);
}

export function signedPageHtml(lang: PageLang, base: string, sender: string, title: string, signedAt: string): string {
  const t = T[lang];
  return shell(
    lang,
    title,
    `<div class="card"><h1 dir="auto">${esc(sender)}</h1><h2 class="ok" style="margin-top:12px">${esc(t.signedTitle)}</h2><p dir="auto">${esc(title)}</p><p class="muted">${esc(t.signedOn)} ${esc(signedAt.slice(0, 10))}</p><a class="link" href="${esc(base)}/pdf?download=1">${esc(t.downloadSigned)}</a></div>`,
    null,
  );
}

export function closedPageHtml(lang: PageLang, message: string): string {
  const t = T[lang];
  return shell(lang, t.unavailable, `<div class="card"><h1>${esc(t.unavailable)}</h1><p>${esc(message)} ${esc(t.askSender)}</p></div>`, null);
}
