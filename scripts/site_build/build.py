"""
Builds the product site into site/: one page per question, Hebrew first and English second, every
page linked to its pair. Run from the repository root: python3 scripts/build-site.py

Pages: home, features, pricing, registration, demo, guides, changelog, license, at /he/<page>/ and
/<page>/. Assets referenced by a page get a copy with a content hash in its name, which the Worker
caches for a year (tools/site/src/index.js).
"""
import hashlib, html, json, os, re, shutil, sys

from . import md
from .config import (CERTIFICATE, CLONE, CONFIG, DEMO_URL, DEPLOY, ITA_REG, ITA_REGISTRY, OUT, REPO, ROOT,
                     SETUP, SHOP_LIVE, SHOP_URL, SITE_URL, CONTACT_ENDPOINT, LICENSE, VERSION)
from .pages_text import NAV, PAGES, UI
from .style import CSS, FAVICON, LOGO
from .text import EN, HE, OPTIONS_EN, OPTIONS_HE

E = html.escape
TEXT = {'en': EN, 'he': HE}
LANGS = ('he', 'en')
KEYS = ('home', 'features', 'pricing', 'registration', 'demo', 'guides', 'changelog', 'license')
HASHED = re.compile(r'\.[0-9a-f]{8}\.[a-z0-9]+$')
REPORTS = ROOT / 'site-reports'
CERT_PDF = 'ita-registration-281801-v1.1.0.pdf'

PAGE_CSS = '''
.skip { position: absolute; inset-inline-start: -9999px; }
.skip:focus { inset-inline-start: 12px; top: 12px; z-index: 60; background: var(--surface); padding: 8px 12px; border-radius: 8px; }
.nav-links a[aria-current=page] { color: var(--text); font-weight: 600; }
.page { padding: 40px 22px 8px; }
.page h1 { font-size: clamp(30px, 4.4vw, 46px); }
.page .lead { margin-inline: 0; }
.crumbs { font-size: 13px; color: var(--text-mute); margin-bottom: 18px; }
.crumbs ol { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; }
.crumbs li + li::before { content: '/'; margin-inline-end: 6px; color: var(--border); }
.crumbs a { text-decoration: none; color: var(--text-dim); }
.prose { max-width: 760px; font-size: 16.5px; }
.prose p, .prose li { color: var(--text-dim); }
.prose h2 { font-size: 24px; margin: 34px 0 10px; }
.prose h3 { font-size: 18px; margin: 24px 0 8px; }
.prose a { color: var(--blue); }
.prose a.btn-primary { color: #ffffff; }
.prose a.btn-ghost { color: var(--text); }
.prose ul, .prose ol { padding-inline-start: 22px; }
.strip { background: var(--bg-2); }
.strip .wrap { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.strip h2 { margin: 0 0 6px; }
.strip p { margin: 0; color: var(--text-dim); max-width: 640px; }
.points { list-style: none; padding: 0; margin: 0 auto 28px; max-width: 760px; text-align: start; }
.points li { position: relative; padding-inline-start: 28px; margin: 10px 0; color: var(--text-dim); }
.points li::before { content: '\\2713'; position: absolute; inset-inline-start: 0; color: var(--green); font-weight: 700; }
.demo-band { text-align: center; }
.more-link { text-align: center; margin-top: 32px; }
.more-link a { color: var(--blue); font-weight: 600; text-decoration: none; }
.cert { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; align-items: start; }
@media (max-width: 820px) { .cert { grid-template-columns: 1fr; } }
.cert img { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); background: #fff; }
.cert .actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0; }
.facts { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 22px 26px; max-width: 860px; margin: 0 auto; }
.facts h2 { font-size: 20px; margin: 0 0 10px; }
.facts ul { margin: 0; padding-inline-start: 20px; color: var(--text-dim); }
.facts li { margin: 6px 0; }
.draft-bar { background: #fef3c7; border-bottom: 1px solid #fcd34d; color: #78350f; text-align: center; font-size: 14px; padding: 8px 16px; }
.guide-list { list-style: none; padding: 0; margin: 0; max-width: 760px; }
.guide-list li { border-bottom: 1px solid var(--border); padding: 16px 0; }
.guide-list a { font-weight: 650; font-size: 18px; text-decoration: none; }
.guide-list p { margin: 4px 0 0; color: var(--text-dim); }
.changelog { direction: ltr; text-align: left; }
.sources { font-size: 14px; }
.faq dt { font-weight: 650; margin-top: 16px; }
.faq dd { margin: 4px 0 0; color: var(--text-dim); }
.guide-cta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 18px; }
'''


# ---------------------------------------------------------------------------------------------
# Paths and assets
# ---------------------------------------------------------------------------------------------

def path_of(lang, key, slug=None):
    base = '/he/' if lang == 'he' else '/'
    if key == 'home':
        return base
    if key == 'guide':
        return f'{base}guides/{slug}/'
    return f'{base}{key}/'


def absolute(path):
    return SITE_URL + path


class Assets:
    """Copies each asset a page uses to a name with its content hash, once per build."""

    def __init__(self):
        self.root = OUT / 'assets'
        self.done = {}
        for folder, _, files in os.walk(self.root):
            for f in files:
                if HASHED.search(f):
                    os.remove(os.path.join(folder, f))

    def exists(self, rel):
        return (self.root / rel).exists()

    def url(self, rel):
        if rel in self.done:
            return self.done[rel]
        src = self.root / rel
        if not src.exists():
            sys.exit(f'Missing asset: site/assets/{rel}')
        digest = hashlib.sha256(src.read_bytes()).hexdigest()[:8]
        name = f'{src.stem}.{digest}{src.suffix}'
        shutil.copyfile(src, src.with_name(name))
        out = '/assets/' + str((src.parent / name).relative_to(self.root)).replace(os.sep, '/')
        self.done[rel] = out
        return out


ASSETS = None


def shot(lang, name):
    """The screenshot's Hebrew variant (dashboard-he.png next to dashboard.png) when one exists."""
    if lang != 'en':
        base, ext = os.path.splitext(name)
        localized = f'{base}-{lang}{ext}'
        if ASSETS.exists(f'screenshots/{localized}'):
            return f'screenshots/{localized}'
    return f'screenshots/{name}'


def img(rel, alt, width=None, height=None, lazy=True, priority=False, cls=''):
    attrs = [f'src="{ASSETS.url(rel)}"', f'alt="{E(alt)}"']
    if width and height:
        attrs.append(f'width="{width}" height="{height}"')
    if lazy and not priority:
        attrs.append('loading="lazy" decoding="async"')
    if priority:
        attrs.append('fetchpriority="high"')
    if cls:
        attrs.append(f'class="{cls}"')
    return '<img ' + ' '.join(attrs) + '>'


# ---------------------------------------------------------------------------------------------
# Layout
# ---------------------------------------------------------------------------------------------

def og_image(page):
    rel = f'og/{page["lang"]}-{page["og"]}.png'
    if ASSETS.exists(rel):
        return absolute(f'/assets/{rel}')
    if ASSETS.exists('og/default.png'):
        return absolute('/assets/og/default.png')
    return absolute(ASSETS.url(shot(page['lang'], 'dashboard.png')))


def head(page):
    lang = page['lang']
    canonical = absolute(page['path'])
    alternates = ''
    if page.get('pair'):
        for l in LANGS:
            if page['pair'].get(l):
                alternates += f'<link rel="alternate" hreflang="{l}" href="{absolute(page["pair"][l])}">\n'
        if page['pair'].get('he'):
            alternates += f'<link rel="alternate" hreflang="x-default" href="{absolute(page["pair"]["he"])}">\n'
    robots = '<meta name="robots" content="noindex, follow">\n' if page.get('noindex') else ''
    md_link = f'<link rel="alternate" type="text/markdown" href="{page["path"]}index.md">\n' if page.get('md') else ''
    image = og_image(page)
    locale = 'he_IL' if lang == 'he' else 'en_US'
    title, desc = E(page['title']), E(page['desc'])
    jsonld = ''.join(
        '<script type="application/ld+json">' + json.dumps(block, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + '</script>\n'
        for block in page.get('jsonld', []))
    return f'''<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
{robots}<link rel="canonical" href="{canonical}">
{alternates}{md_link}<meta property="og:site_name" content="Open Ledger IL">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="{'article' if page['key'] == 'guide' else 'website'}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="{locale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{image}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
{fonts_head()}<style>{CSS}{PAGE_CSS}</style>
{jsonld}{analytics_head()}'''


def fonts_head():
    return ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
            '<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">\n')


def analytics_head():
    return ''


def header(page):
    lang = page['lang']
    other = 'en' if lang == 'he' else 'he'
    links = []
    for key, label in NAV[lang]:
        current = ' aria-current="page"' if page['key'] == key or (page['key'] == 'guide' and key == 'guides') else ''
        links.append(f'<a href="{path_of(lang, key)}"{current}>{E(label)}</a>')
    switch_to = (page.get('pair') or {}).get(other) or path_of(other, 'home')
    return f'''<header>
  <div class="wrap nav">
    <a class="brand" href="{path_of(lang, 'home')}">
      {LOGO}
      Open Ledger IL
    </a>
    <nav class="nav-links" aria-label="{E('Main' if lang == 'en' else 'ראשי')}">
      {''.join(links)}
    </nav>
    <div class="nav-end">
      <a class="lang" href="{switch_to}" hreflang="{other}" lang="{other}">{E(UI[lang]['switch'])}</a>
      <a class="btn btn-ghost btn-sm" href="{REPO}">{E(TEXT[lang]['github'])}</a>
    </div>
  </div>
</header>'''


def footer(page):
    lang = page['lang']
    c = TEXT[lang]
    labels = c['foot_links']
    items = [
        (REPO, labels[0]), (DEPLOY, labels[1]), (SETUP, labels[2]),
        (path_of(lang, 'license'), labels[3]),
        (path_of(lang, 'changelog'), PAGES[lang]['changelog']['crumb']),
    ]
    links = '\n      '.join(f'<a href="{u}">{E(t)}</a>' for u, t in items)
    return f'''<footer>
  <div class="wrap foot">
    <div>
      {links}
    </div>
    <div>{E(c['foot_note'])}</div>
  </div>
</footer>'''


def crumbs(page):
    if page['key'] == 'home':
        return ''
    items = ''.join(
        f'<li><a href="{path}">{E(label)}</a></li>' if path else f'<li aria-current="page">{E(label)}</li>'
        for label, path in page['crumbs'])
    return f'<nav class="crumbs" aria-label="{E(UI[page["lang"]]["crumbs_label"])}"><ol>{items}</ol></nav>'


def document(page, main, scripts=''):
    lang = page['lang']
    draft = f'<div class="draft-bar" role="note">{E(UI[lang]["guides_draft_bar"])}</div>\n' if page.get('draft') else ''
    return f'''<!doctype html>
<html lang="{lang}" dir="{'rtl' if lang == 'he' else 'ltr'}">
<head>
{head(page)}</head>
<body>
{draft}{header(page)}
<main id="top">
{main}
</main>
{footer(page)}
{scripts}{analytics_body(page)}</body>
</html>
'''


def analytics_body(page):
    return ''


def page_intro(page, lead=''):
    lead_html = f'<p class="lead">{lead}</p>' if lead else ''
    return f'''  <div class="wrap page">
    {crumbs(page)}
    <h1>{E(page['h1'])}</h1>
    {lead_html}
  </div>'''


# ---------------------------------------------------------------------------------------------
# Sections, moved from the single-page site
# ---------------------------------------------------------------------------------------------

def demo_attrs():
    return f'href="{DEMO_URL}" target="_blank" rel="noopener" data-demo'


def section_phones(lang):
    c = TEXT[lang]
    phones = '\n'.join(
        f'''        <figure class="phone">
          <div class="frame">{img(shot(lang, i), alt, 585, 1266)}</div>
          <figcaption><b>{E(h)}</b>{E(p)}</figcaption>
        </figure>''' for i, alt, h, p in c['phones'])
    return f'''  <section id="mobile" class="plain">
    <div class="wrap">
      <div class="sec-head">
        <h2>{E(c['mob_h'])}</h2>
        <p>{E(c['mob_p'])}</p>
      </div>
      <div class="phones">
{phones}
      </div>
    </div>
  </section>'''


def section_highlights(lang, more=True):
    c = TEXT[lang]
    feats = '\n'.join(
        f'''        <div class="feat">
          <div class="ico" aria-hidden="true">{ico}</div>
          <h3>{E(h)}</h3>
          <p>{E(p)}</p>
        </div>''' for ico, h, p in c['features'])
    link = f'<p class="more-link"><a href="{path_of(lang, "features")}">{E(UI[lang]["all_features"])}</a></p>' if more else ''
    return f'''  <section id="features">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{E(c['feat_eyebrow'])}</div>
        <h2>{E(c['feat_h'])}</h2>
        <p>{E(c['feat_p'])}</p>
      </div>
      <div class="features">
{feats}
      </div>
      {link}
    </div>
  </section>'''


def section_feature_list(lang):
    c = TEXT[lang]
    groups = '\n'.join(
        f'''        <details class="fgroup">
          <summary>{E(h)}<span class="count">{len(items)}</span></summary>
          <ul>
''' + '\n'.join(f'            <li>{E(i)}</li>' for i in items) + '''
          </ul>
        </details>''' for h, items in c['feature_list'])
    return f'''  <section id="list" class="plain">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{E(c['list_eyebrow'])}</div>
        <h2>{E(c['list_h'])}</h2>
        <p>{E(c['list_p'])}</p>
      </div>
      <div class="flist">
{groups}
      </div>
    </div>
  </section>'''


def section_gallery(lang):
    c = TEXT[lang]
    shots = '\n'.join(
        f'''        <figure class="gcard">
          {img(shot(lang, i), alt, 1440, 900)}
          <figcaption><b>{E(h)}.</b> {E(p)}</figcaption>
        </figure>''' for i, alt, h, p in c['shots'])
    return f'''  <section id="screens">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{E(c['shots_eyebrow'])}</div>
        <h2>{E(c['shots_h'])}</h2>
      </div>
      <div class="gallery">
{shots}
      </div>
    </div>
  </section>'''


def section_rules(lang):
    c = TEXT[lang]
    rules = '\n'.join(f'''        <li>
          <b>{E(h)}</b>
          <span>{E(p)}</span>
        </li>''' for h, p in c['rules'])
    return f'''  <section id="rules">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{E(c['rules_eyebrow'])}</div>
        <h2>{E(c['rules_h'])}</h2>
        <p>{E(c['rules_p'])}</p>
      </div>
      <ul class="rules">
{rules}
      </ul>
    </div>
  </section>'''


def section_options(lang):
    """The pricing cards and the setup form. Before the shop is live the ₪99 card is left out."""
    html_ = (OPTIONS_EN if lang == 'en' else OPTIONS_HE).replace('__SHOP__', SHOP_URL).replace('__DEPLOY__', DEPLOY).replace('__CONTACT__', CONTACT_ENDPOINT)
    if SHOP_LIVE:
        return re.sub(r'<!--/?(SHOP|H)-->\n?', '', html_)
    html_ = re.sub(r'<!--SHOP-->.*?<!--/SHOP-->\n', '', html_, flags=re.S)
    two = 'Install it yourself, or have it set up for you' if lang == 'en' else 'להתקין בעצמך, או לקבל אותה מוקמת'
    html_ = re.sub(r'<!--H-->.*?<!--/H-->', two, html_)
    return html_.replace('<div class="plans">', '<div class="plans plans-2">')


def section_how(lang):
    c = TEXT[lang]
    steps = '\n'.join(f'''        <li class="step">
          <h3>{E(h)}</h3>
          <p>{E(p)}</p>
        </li>''' for h, p in c['steps'])
    needs = '\n'.join(
        f'''          <tr><td><b>{E(n)}</b><span class="tag{' req' if req else ''}">{E(c['required'] if req else c['optional'])}</span></td><td><span>{E(note)}</span></td></tr>'''
        for n, req, note in c['needs'])
    paid = ''.join(f'<li>{E(x)}</li>' for x in c['paid'])
    limits = '\n'.join(f'            <li>{E(x)}</li>' for x in c['limits'])
    reg_link = f'<p><a href="{path_of(lang, "registration")}">{E(c["reg_title"])}</a></p>'
    more_h = 'Workers Paid and known limits' if lang == 'en' else 'Workers Paid ומגבלות ידועות'
    return f'''  <section id="how">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{E(c['how_eyebrow'])}</div>
        <h2>{E(c['how_h'])}</h2>
        <p>{E(c['how_p'])}</p>
      </div>
      <ol class="steps">
{steps}
      </ol>
      <div class="cmd">
        <code id="cmd">{E(CLONE)}</code>
        <button id="copy" type="button">{E(c['copy'])}</button>
      </div>
      <p class="cmd-note">{E(c['cmd_note'])}</p>

      <div class="sec-head sub" id="setup">
        <h2>{E(c['need_h'])}</h2>
        <p>{E(c['need_p'])}</p>
      </div>
      <table>
        <thead><tr><th>{E(c['need_cols'][0])}</th><th>{E(c['need_cols'][1])}</th></tr></thead>
        <tbody>
{needs}
        </tbody>
      </table>
      <details class="more">
        <summary>{E(more_h)}</summary>
        <div class="more-body">
          <h3>{E(c['paid_title'])}</h3>
          <p>{E(c['paid_intro'])}</p>
          <ul>{paid}</ul>
          <h3>{E(c['limits_h'])}</h3>
          <ul>
{limits}
          </ul>
          {reg_link}
        </div>
      </details>
    </div>
  </section>'''


COPY_SCRIPT = '''<div class="toast" id="toast" role="status">__COPIED__</div>
<script>
document.getElementById('copy').addEventListener('click', async function () {
  var text = document.getElementById('cmd').textContent;
  try { await navigator.clipboard.writeText(text); }
  catch (err) {
    var t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove();
  }
  var toast = document.getElementById('toast');
  toast.classList.add('on');
  setTimeout(function () { toast.classList.remove('on'); }, 1600);
});
</script>
'''


def section_strip(lang):
    u = UI[lang]
    text = u['strip_p_shop'] if SHOP_LIVE else u['strip_p']
    return f'''  <section class="strip">
    <div class="wrap">
      <div>
        <h2>{E(u['strip_h'])}</h2>
        <p>{E(text)}</p>
      </div>
      <a class="btn btn-ghost btn-setup" href="{path_of(lang, 'pricing')}">{E(u['strip_btn'])}</a>
    </div>
  </section>'''


def section_demo_band(lang, points=None, heading=True):
    u, c = UI[lang], TEXT[lang]
    items = ''.join(f'<li>{E(p)}</li>' for p in (points or u['demo_points']))
    h = f'<h2>{E(u["demo_h"])}</h2>' if heading else ''
    return f'''  <section class="demo-band" id="demo">
    <div class="wrap">
      {h}
      <ul class="points">{items}</ul>
      <div class="cta cta-demo"><a class="btn btn-primary btn-lg btn-demo" {demo_attrs()}>{E(c['demo_cta'])}</a></div>
      <p class="demo-note">{E(c['demo_note'])}</p>
    </div>
  </section>'''


def hero(lang):
    c = TEXT[lang]
    return f'''  <div class="wrap">
    <div class="hero">
      <div class="badge">{c['badge']}</div>
      <h1>{c['h1']}</h1>
      <p class="lead">{E(c['lead'])}</p>
      <div class="cta cta-demo">
        <a class="btn btn-primary btn-lg btn-demo" {demo_attrs()}>{E(c['demo_cta'])}</a>
      </div>
      <p class="demo-note">{E(c['demo_note'])}</p>
      <div class="cta cta-links">
        <a class="btn btn-ghost" href="{REPO}">{E(c['cta'][0])}</a>
        <a class="btn btn-ghost" href="{DEPLOY}">{E(c['cta'][1])}</a>
        <a class="btn btn-ghost btn-setup" href="{path_of(lang, 'pricing')}">{E(c['cta'][2])}</a>
      </div>
      <div class="shot">
        {img(shot(lang, 'dashboard.png'), c['shot_alt'], 1440, 900, lazy=False, priority=True)}
      </div>
      <p class="shot-cap">{E(c['shot_cap'])}</p>
    </div>
  </div>'''


# ---------------------------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------------------------

def base_page(lang, key, slug=None, **extra):
    t = PAGES[lang].get(key, {}) if key != 'guide' else {}
    page = dict(lang=lang, key=key, slug=slug, path=path_of(lang, key, slug), og=key if key != 'guide' else f'guide-{slug}',
                title=t.get('title', ''), desc=t.get('desc', ''), h1=t.get('h1', ''), jsonld=[], md='',
                pair={l: path_of(l, key, slug) for l in LANGS})
    home = (PAGES[lang]['home']['crumb'], path_of(lang, 'home'))
    page['crumbs'] = [home, (t.get('crumb', ''), None)]
    page.update(extra)
    return page


def build_home(lang):
    page = base_page(lang, 'home')
    main = '\n'.join([hero(lang), section_phones(lang), section_highlights(lang), key_facts(lang), section_strip(lang), section_demo_band(lang)])
    return page, main, ''


def build_features(lang):
    page = base_page(lang, 'features')
    main = '\n'.join([page_intro(page, E(TEXT[lang]['feat_p'])), section_feature_list(lang), section_gallery(lang), section_rules(lang)])
    return page, main, ''


def build_pricing(lang):
    page = base_page(lang, 'pricing')
    main = '\n'.join([page_intro(page), section_options(lang), key_facts(lang), section_how(lang)])
    return page, main, COPY_SCRIPT.replace('__COPIED__', E(TEXT[lang]['copied']))


def build_registration(lang):
    page = base_page(lang, 'registration')
    c, u = TEXT[lang], UI[lang]
    refs = {0: ' <sup><a href="#ref-2">[2]</a></sup>', 1: ' <sup><a href="#ref-1">[1]</a></sup>'}
    paras = ''.join(f'<p>{E(x)}{refs.get(i, "")}</p>' for i, x in enumerate(c['reg_p']))

    def ref(i, t, url, label):
        q = f' <q lang="he" dir="rtl">{E(c["reg_quote"])}</q>' if i == 0 else ''
        a = f' <a href="{url}" rel="noopener">{label}</a>' if url else ''
        return f'<li id="ref-{i + 1}">{E(t)}{q}{a}</li>'

    reg_refs = ''.join(ref(i, *r) for i, r in enumerate(c['reg_refs']))
    pdf = ASSETS.url(CERT_PDF) if ASSETS.exists(CERT_PDF) else None
    picture = img('registration/certificate-281801.png', u['reg_cert_alt'], 1240, 1754) if ASSETS.exists('registration/certificate-281801.png') else ''
    download = f'<a class="btn btn-primary" href="{pdf}" download>{E(u["reg_download"])}</a>' if pdf else ''
    main = page_intro(page) + f'''
  <section class="plain">
    <div class="wrap cert">
      <div>{picture}<p class="shot-cap">{E(u['reg_redacted'])}</p></div>
      <div class="prose">
        {paras}
        <div class="actions">{download}<a class="btn btn-ghost" href="{ITA_REGISTRY}" rel="noopener">{E(u['reg_registry'])}</a></div>
        <p><a href="{ITA_REG}" rel="noopener">{E(c['reg_link'])}</a></p>
        <div class="refs"><b>{E(c['reg_refs_h'])}</b><ol>{reg_refs}</ol></div>
      </div>
    </div>
  </section>'''
    return page, main, ''


def build_demo(lang):
    page = base_page(lang, 'demo')
    u = UI[lang]
    main = '\n'.join([page_intro(page, E(u['demo_page_lead'])), section_demo_band(lang, u['demo_points'] + u['demo_more'], heading=False),
                      f'''  <div class="wrap"><div class="shot">{img(shot(lang, 'dashboard.png'), TEXT[lang]['shot_alt'], 1440, 900)}</div></div>''',
                      section_phones(lang)])
    return page, main, ''


def build_guides_index(lang, guides):
    page = base_page(lang, 'guides')
    published = [g for g in guides if g['lang'] == lang and g['published']]
    if published:
        items = ''.join(f'<li><a href="{g["path"]}">{E(g["title"])}</a><p>{E(g["desc"])}</p></li>' for g in published)
        body = f'<ul class="guide-list">{items}</ul>'
    else:
        body = f'<p class="lead">{E(UI[lang]["guides_none"])}</p>'
    main = page_intro(page) + f'\n  <section class="plain"><div class="wrap">{body}</div></section>'
    return page, main, ''


def changelog_html():
    text = (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
    text = re.sub(r'^# .*\n', '', text, count=1)
    return md.to_html(text, refs=False)


def build_changelog(lang):
    page = base_page(lang, 'changelog')
    u = UI[lang]
    note = f'<p>{E(u["changelog_lang_note"])}</p>' if u['changelog_lang_note'] else ''
    main = page_intro(page, E(u['changelog_intro'])) + f'''
  <section class="plain">
    <div class="wrap">{note}<div class="prose changelog" lang="en">{changelog_html()}</div></div>
  </section>'''
    return page, main, ''


def build_license(lang):
    page = base_page(lang, 'license')
    u = UI[lang]
    points = ''.join(f'<li>{E(p)}</li>' for p in u['license_points'])
    main = page_intro(page) + f'''
  <section class="plain">
    <div class="wrap prose">
      <p>{E(u['license_p'])}</p>
      <ul>{points}</ul>
      <p>{E(u['license_service'])}</p>
      <p><a href="{LICENSE}">{E(u['license_full'])}</a></p>
      <p><a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener">{E(u['license_gnu'])}</a></p>
    </div>
  </section>'''
    return page, main, ''


def key_facts(lang):
    """Filled in by R32 task 6."""
    return ''


# ---------------------------------------------------------------------------------------------
# Guides: scripts/guides/<lang>/<slug>.md, with front matter
# ---------------------------------------------------------------------------------------------

GUIDES_DIR = ROOT / 'scripts' / 'guides'
MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']


def load_rates():
    path = OUT / 'data' / 'rates.json'
    if not path.exists():
        sys.exit('site/data/rates.json is missing. The guides read yearly figures from it.')
    return json.loads(path.read_text(encoding='utf-8'))


def token_values(lang, rates):
    """Every {{token}} a guide may use, formatted for the language. One edit to rates.json updates them all."""
    r = rates['rates']

    def money(item):
        sign = {'ILS': '₪', 'USD': '$'}[item['unit']]
        return f'{sign}{item["value"]:,}'

    def day(iso):
        y, m, d = (int(x) for x in iso.split('-'))
        return f'{d}.{m}.{y}' if lang == 'he' else f'{d} {MONTHS_EN[m - 1]} {y}'

    return {
        'repo': REPO, 'site': SITE_URL,
        'patur_ceiling': money(r['patur_ceiling']), 'patur_ceiling_year': str(r['patur_ceiling']['year']),
        'vat_rate': f'{r["vat_rate"]["value"]}%', 'vat_rate_from': day(r['vat_rate']['from']),
        'allocation_threshold': money(r['allocation_threshold']), 'allocation_threshold_from': day(r['allocation_threshold']['from']),
        'workers_paid_price': money(r['workers_paid_price']),
    }


def fill(text, values, where):
    def sub(m):
        key = m.group(1)
        if key not in values:
            sys.exit(f'{where}: unknown token {{{{{key}}}}}. Add it to site/data/rates.json and token_values().')
        return values[key]
    return re.sub(r'\{\{\s*([a-z_]+)\s*\}\}', sub, text)


def seo_title(title):
    """The <title>: the guide title when it fits, else the part before the colon and the brand."""
    if len(title) < 60:
        return title
    short = title.split(':')[0].strip()
    return f'{short} · Open Ledger IL' if len(short) + 17 < 60 else short[:59]


def load_guides(rates):
    guides = []
    for lang in LANGS:
        folder = GUIDES_DIR / lang
        if not folder.exists():
            continue
        values = token_values(lang, rates)
        for f in sorted(folder.glob('*.md')):
            where = f'scripts/guides/{lang}/{f.name}'
            meta, body = md.front_matter(f.read_text(encoding='utf-8'))
            for key in ('title', 'description', 'updated'):
                if not meta.get(key):
                    sys.exit(f'{where}: front matter needs {key}.')
            meta = json.loads(fill(json.dumps(meta, ensure_ascii=False), {k: v.replace('"', '\\"') for k, v in values.items()}, where))
            body = fill(body, values, where)
            # The page text a reader sees: the body and the questions and answers.
            faq_text = ' '.join(str(x.get('q', '')) + ' ' + str(x.get('a', '')) for x in (meta.get('faq') or []) if isinstance(x, dict))
            words = len(re.findall(r'\S+', md.plain(re.sub(r'^#+ ', '', body, flags=re.M)) + ' ' + faq_text))
            guides.append(dict(
                lang=lang, slug=f.stem, path=path_of(lang, 'guide', f.stem), title=str(meta['title']), desc=str(meta['description']),
                published=meta.get('published') is True, updated=str(meta['updated']), sources=list(meta.get('sources') or []),
                faq=list(meta.get('faq') or []), body=body, words=words, todo=body.count('[TO CHECK]'), file=where))
    return guides


def build_guide(g, guides):
    lang = g['lang']
    u = UI[lang]
    pair = {x['lang']: x['path'] for x in guides if x['slug'] == g['slug']}
    page = dict(lang=lang, key='guide', slug=g['slug'], path=g['path'], og=f'guide-{g["slug"]}', title=seo_title(g['title']),
                desc=g['desc'], h1=g['title'], jsonld=[], md='', pair=pair, noindex=not g['published'], draft=not g['published'],
                guide=g)
    page['crumbs'] = [(PAGES[lang]['home']['crumb'], path_of(lang, 'home')), (PAGES[lang]['guides']['crumb'], path_of(lang, 'guides')), (g['title'], None)]
    faq = ''.join(f'<dt>{E(item["q"])}</dt><dd>{E(item["a"])}</dd>' for item in g['faq'] if isinstance(item, dict))
    sources = ''.join(f'<li id="src-{i + 1}"><a href="{E(s)}" rel="noopener">{E(s)}</a></li>' for i, s in enumerate(g['sources']))
    updated = f'{u["guide_updated"]} {g["updated"]}'
    main = page_intro(page, E(g['desc'])) + f'''
  <section class="plain">
    <div class="wrap prose">
      <p class="shot-cap" style="text-align:start">{E(updated)}</p>
      {md.to_html(g['body'])}
      <div class="guide-cta">
        <a class="btn btn-primary" {demo_attrs()}>{E(u['guide_cta_demo'])}</a>
        <a class="btn btn-ghost" href="{path_of(lang, 'pricing')}">{E(u['guide_cta_pricing'])}</a>
      </div>
      <h2 id="faq">{E(u['guide_faq'])}</h2>
      <dl class="faq">{faq}</dl>
      <h2 id="sources">{E(u['guide_sources'])}</h2>
      <ol class="sources">{sources}</ol>
    </div>
  </section>'''
    return page, main, ''


BUILDERS = {
    'home': build_home, 'features': build_features, 'pricing': build_pricing, 'registration': build_registration,
    'demo': build_demo, 'changelog': build_changelog, 'license': build_license,
}


# ---------------------------------------------------------------------------------------------
# Checks and output
# ---------------------------------------------------------------------------------------------

def check_meta(pages):
    problems = []
    seen = {}
    for p in pages:
        if len(p['title']) >= 60:
            problems.append(f'{p["path"]}: title is {len(p["title"])} characters, keep it under 60')
        if len(p['desc']) >= 155:
            problems.append(f'{p["path"]}: description is {len(p["desc"])} characters, keep it under 155')
        if p['title'] in seen:
            problems.append(f'{p["path"]}: the same title as {seen[p["title"]]}')
        seen[p['title']] = p['path']
    if problems:
        sys.exit('Page metadata:\n  ' + '\n  '.join(problems))


def write(rel, text, written):
    path = OUT / rel.lstrip('/')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8', newline='\n')
    written.add(path.resolve())


def prune(written):
    """Removes pages a previous build wrote and this one did not, so a renamed page leaves nothing behind."""
    for folder, dirs, files in os.walk(OUT, topdown=False):
        rel = os.path.relpath(folder, OUT)
        if rel.split(os.sep)[0] in ('assets', 'data'):
            continue
        for f in files:
            p = (OUT / rel / f).resolve() if rel != '.' else (OUT / f).resolve()
            if p.suffix in ('.html', '.md', '.xml', '.txt') and p not in written:
                os.remove(p)
        if rel != '.' and not os.listdir(folder):
            os.rmdir(folder)


def main():
    global ASSETS
    OUT.mkdir(exist_ok=True)
    ASSETS = Assets()
    rates = load_rates()
    guides = load_guides(rates)
    built = []
    for lang in LANGS:
        for key in KEYS:
            if key == 'guides':
                built.append(build_guides_index(lang, guides))
            else:
                built.append(BUILDERS[key](lang))
    for g in guides:
        built.append(build_guide(g, guides))
    pages = [p for p, _, _ in built]
    check_meta(pages)
    written = set()
    for page, main_html, scripts in built:
        write(page['path'] + 'index.html', document(page, main_html, scripts), written)
    write('/favicon.svg', FAVICON, written)
    write('/404.html', not_found(), written)
    prune(written)
    REPORTS.mkdir(exist_ok=True)
    og = [dict(file=f'og/{p["lang"]}-{p["og"]}.png', title=p['h1'] or PAGES[p['lang']]['home']['title'].split(':')[0],
               kicker=p['title'], lang=p['lang']) for p in pages]
    (REPORTS / 'og-pages.json').write_text(json.dumps(og, ensure_ascii=False, indent=1), encoding='utf-8')
    report = [dict(file=g['file'], path=g['path'], words=g['words'], todo=g['todo'], published=g['published']) for g in guides]
    (REPORTS / 'guides.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    for g in guides:
        if not 600 <= g['words'] <= 1200:
            print(f'note: {g["file"]} has {g["words"]} words, the target is 600 to 1,200')
    print(f'built {len(pages)} pages into {OUT}')


def not_found():
    return f'''<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>העמוד לא נמצא · Page not found · Open Ledger IL</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>{CSS}
.nf {{ padding: 96px 0; text-align: center; }}</style>
</head>
<body>
<main class="wrap nf">
  <h1>העמוד לא נמצא</h1>
  <p class="lead">הכתובת השתנתה או שאינה קיימת. <a href="/he/">לעמוד הבית</a></p>
  <p class="lead" lang="en" dir="ltr">This page does not exist. <a href="/">Go to the home page</a></p>
</main>
</body>
</html>
'''
