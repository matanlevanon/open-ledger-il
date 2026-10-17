"""
A small Markdown reader for the changelog and the guides, standard library only, so Workers Builds
needs nothing installed. It handles what those files use: headings, paragraphs, lists (with
continuation lines), bold, inline code, links and reference marks like [1].
"""
import html, re

INLINE_CODE = re.compile(r'`([^`]+)`')
BOLD = re.compile(r'\*\*(.+?)\*\*')
LINK = re.compile(r'\[([^\]]+)\]\(([^)\s]+)\)')
REF = re.compile(r'\[(\d+)\](?!\()')


def inline(text, refs=True):
    """One line of Markdown to HTML. Text is escaped first, then the marks are applied."""
    codes = []

    def keep(m):
        codes.append(f'<code>{html.escape(m.group(1))}</code>')
        return f'\u0000{len(codes) - 1}\u0000'

    text = INLINE_CODE.sub(keep, text)
    text = html.escape(text, quote=False)
    def link(m):
        href = m.group(2)
        rel = ' rel="noopener"' if href.startswith('http') else ''
        return '<a href="' + html.escape(href) + '"' + rel + '>' + m.group(1) + '</a>'

    text = LINK.sub(link, text)
    text = BOLD.sub(r'<b>\1</b>', text)
    if refs:
        text = REF.sub(r'<sup><a href="#src-\1">[\1]</a></sup>', text)
    return re.sub('\u0000(\\d+)\u0000', lambda m: codes[int(m.group(1))], text)


def plain(text):
    """The text without Markdown marks, for descriptions and llms-full.txt."""
    text = LINK.sub(r'\1', text)
    return INLINE_CODE.sub(r'\1', BOLD.sub(r'\1', text))


def blocks(md):
    """Splits Markdown into (kind, data) blocks: heading (level, text), list (ordered, items), code (text), para (text)."""
    out = []
    para, items, ordered = [], None, False

    def flush():
        nonlocal para, items
        if para:
            out.append(('para', ' '.join(para)))
            para = []
        if items is not None:
            out.append(('list', (ordered, items)))
            items = None

    code = None
    for raw in md.splitlines():
        line = raw.rstrip()
        if line.strip().startswith('```'):
            if code is None:
                flush()
                code = []
            else:
                out.append(('code', '\n'.join(code)))
                code = None
            continue
        if code is not None:
            code.append(raw.rstrip())
            continue
        if line.strip().startswith('|'):
            if not (out and out[-1][0] == 'table' and not para and items is None):
                flush()
                out.append(('table', []))
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            if not all(re.fullmatch(r':?-{3,}:?', c) for c in cells):
                out[-1][1].append(cells)
            continue
        m = re.match(r'^(#{1,4})\s+(.*)$', line)
        if m:
            flush()
            out.append(('heading', (len(m.group(1)), m.group(2).strip())))
            continue
        m = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', line)
        if m and len(m.group(1)) < 2:
            if para:
                flush()
            is_ordered = m.group(2)[0].isdigit()
            if items is None:
                items, ordered = [], is_ordered
            items.append(m.group(3).strip())
            continue
        if not line.strip():
            flush()
            continue
        if items is not None and raw.startswith('  '):
            items[-1] += ' ' + line.strip()
            continue
        if items is not None:
            flush()
        para.append(line.strip())
    flush()
    return out


def to_html(md, shift=0, refs=True):
    """Markdown to HTML. shift moves headings down, so a page keeps one h1."""
    parts = []
    for kind, data in blocks(md):
        if kind == 'heading':
            level, text = data
            n = min(6, level + shift)
            slug = re.sub(r'[^\w\u0590-\u05ff]+', '-', plain(text).lower()).strip('-')
            parts.append(f'<h{n} id="{html.escape(slug)}">{inline(text, refs)}</h{n}>')
        elif kind == 'list':
            ordered, items = data
            tag = 'ol' if ordered else 'ul'
            parts.append(f'<{tag}>' + ''.join(f'<li>{inline(i, refs)}</li>' for i in items) + f'</{tag}>')
        elif kind == 'table':
            rows = data
            head = ''.join(f'<th>{inline(c, refs)}</th>' for c in rows[0]) if rows else ''
            body = ''.join('<tr>' + ''.join(f'<td>{inline(c, refs)}</td>' for c in r) + '</tr>' for r in rows[1:])
            # An empty first header cell marks a side-by-side comparison: equal option columns.
            cls = ' class="compare"' if rows and not rows[0][0].strip() else ''
            parts.append(f'<div class="table-wrap"><table{cls}><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
        elif kind == 'code':
            parts.append(f'<p class="cmd" dir="ltr"><code>{html.escape(data)}</code></p>')
        else:
            parts.append(f'<p>{inline(data, refs)}</p>')
    return '\n'.join(parts)


def front_matter(text):
    """Splits '---' front matter from the body. Reads the subset the guides use:
    key: value, key: [list of strings as '- item'], and faq as '- q: ...' with an indented 'a: ...'."""
    if not text.startswith('---'):
        return {}, text
    end = text.find('\n---', 3)
    if end < 0:
        return {}, text
    head, body = text[3:end].strip('\n'), text[end + 4:].lstrip('\n')
    meta, key = {}, None
    for raw in head.splitlines():
        if not raw.strip() or raw.strip().startswith('#'):
            continue
        m = re.match(r'^([A-Za-z_]+):\s*(.*)$', raw)
        if m and not raw.startswith(' '):
            key, value = m.group(1), m.group(2).strip()
            if value == '':
                meta[key] = []
            else:
                meta[key] = scalar(value)
            continue
        m = re.match(r'^\s*-\s+q:\s*(.*)$', raw)
        if m and key:
            meta[key].append({'q': scalar(m.group(1)), 'a': ''})
            continue
        m = re.match(r'^\s+a:\s*(.*)$', raw)
        if m and key and meta[key] and isinstance(meta[key][-1], dict):
            meta[key][-1]['a'] = scalar(m.group(1))
            continue
        m = re.match(r'^\s*-\s+(.*)$', raw)
        if m and key:
            meta[key].append(scalar(m.group(1)))
            continue
        # A wrapped continuation of the last value.
        if key and isinstance(meta.get(key), list) and meta[key]:
            last = meta[key][-1]
            if isinstance(last, dict):
                last['a'] = (last['a'] + ' ' + raw.strip()).strip()
            else:
                meta[key][-1] = f'{last} {raw.strip()}'
        elif key:
            meta[key] = f'{meta[key]} {raw.strip()}'.strip()
    return meta, body


def scalar(value):
    if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
        return value[1:-1]
    if value in ('true', 'false'):
        return value == 'true'
    return value
