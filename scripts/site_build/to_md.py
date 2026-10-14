"""
Turns a built page's <main> into clean Markdown, for <path>/index.md and llms-full.txt. Standard
library only. Scripts, forms, buttons, images, decorative icons and breadcrumbs are dropped.
"""
from html.parser import HTMLParser
import re

SKIP = {'script', 'style', 'form', 'svg', 'nav', 'button', 'template'}
VOID = {'br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'wbr'}
BLOCK = {'p', 'div', 'section', 'figure', 'figcaption', 'details', 'summary', 'dl', 'dd'}


class _MD(HTMLParser):
    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.out = []
        self.skip = []          # stack of tag names opened while skipping
        self.href = []
        self.lists = []
        self.li = 0
        self.heading = None
        self.table = None       # {'row': n, 'cells': n}
        self.space_after_bold = False

    def _text(self):
        return ''.join(self.out)

    def _nl(self, n=2):
        stripped = self._text().rstrip(' ')
        if not stripped:
            return
        have = len(stripped) - len(stripped.rstrip('\n'))
        if have < n:
            self.out.append('\n' * (n - have))

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self.skip:
            if tag not in VOID:
                self.skip.append(tag)
            return
        if tag in SKIP or a.get('aria-hidden') == 'true':
            if tag not in VOID:
                self.skip.append(tag)
            return
        if tag in ('h1', 'h2', 'h3', 'h4'):
            if self.li:
                self.out.append('**')
                self.heading = 'li'
            else:
                self._nl()
                self.out.append('#' * int(tag[1]) + ' ')
                self.heading = tag
        elif tag in ('ul', 'ol'):
            self._nl(1 if self.lists else 2)
            self.lists.append([tag, 0])
        elif tag == 'li':
            self._nl(1)
            self.li += 1
            kind = self.lists[-1] if self.lists else ['ul', 0]
            kind[1] += 1
            indent = '  ' * (len(self.lists) - 1)
            self.out.append(f'{indent}{kind[1]}. ' if kind[0] == 'ol' else f'{indent}- ')
        elif tag in ('b', 'strong'):
            self.out.append('**')
        elif tag == 'code':
            self.out.append('`')
        elif tag == 'br':
            self.out.append(' ' if self.heading else '\n')
        elif tag == 'a':
            href = a.get('href') or ''
            if href.startswith('/'):
                href = self.base + href
            self.href.append(href)
            self.out.append('[')
        elif tag == 'table':
            self._nl()
            self.table = {'row': 0, 'cells': 0}
        elif tag == 'tr':
            self._nl(1)
            self.out.append('|')
            if self.table is not None:
                self.table['cells'] = 0
        elif tag in ('td', 'th'):
            self.out.append(' ')
        elif tag == 'dt':
            self._nl()
            self.out.append('**')
        elif tag in BLOCK:
            if not self.li:
                self._nl()

    def handle_endtag(self, tag):
        if self.skip:
            if self.skip[-1] == tag:
                self.skip.pop()
            return
        if tag in ('h1', 'h2', 'h3', 'h4'):
            if self.heading == 'li':
                self.out.append('** ')
            else:
                self._nl()
            self.heading = None
        elif tag in ('ul', 'ol'):
            if self.lists:
                self.lists.pop()
            if not self.lists:
                self._nl()
        elif tag == 'li':
            self.li = max(0, self.li - 1)
        elif tag in ('b', 'strong'):
            self.out.append('**')
            self.space_after_bold = True
            return
        elif tag == 'code':
            self.out.append('`')
        elif tag == 'a':
            href = self.href.pop() if self.href else ''
            self.out.append(f']({href})' if href and not href.startswith('#') else ']')
        elif tag in ('td', 'th'):
            self.out.append(' |')
            if self.table is not None:
                self.table['cells'] += 1
        elif tag == 'tr':
            if self.table is not None:
                if self.table['row'] == 0:
                    self.out.append('\n|' + ' --- |' * max(1, self.table['cells']))
                self.table['row'] += 1
        elif tag == 'table':
            self.table = None
            self._nl()
        elif tag == 'dt':
            self.out.append('**')
        elif tag in BLOCK:
            if not self.li:
                self._nl()
        self.space_after_bold = False

    def handle_data(self, data):
        if self.skip:
            return
        text = re.sub(r'\s+', ' ', data)
        if self.space_after_bold and text[:1].isalnum():
            text = ' ' + text
        self.space_after_bold = False
        if not text.strip():
            if self.out and not self.out[-1].endswith((' ', '\n')):
                self.out.append(' ')
            return
        last = self._text()[-2:]
        if last.endswith('\n') or last in ('- ', '# ', '. '):
            text = text.lstrip()
        elif last.endswith('|'):
            text = ' ' + text.lstrip()
        self.out.append(text)


def main_markdown(html, base, title=None):
    """The page's <main> as Markdown. base turns site paths into full addresses."""
    m = re.search(r'<main[^>]*>([\s\S]*)</main>', html)
    body = m.group(1) if m else html
    parser = _MD(base)
    parser.feed(body)
    text = parser._text()
    text = re.sub(r'\[\s*\]\([^)]*\)', '', text)           # links with no text (images only)
    text = re.sub(r'\[([^\]]*)\](?!\()', r'\1', text)      # anchors within the page
    text = re.sub(r'\*\*\s*\*\*', '', text)
    text = re.sub(r'\|[ \t]+\|', '| |', text)
    text = re.sub(r'[ \t]+\n', '\n', text)
    text = re.sub(r'\n[ \t]+(?=[^\s-])', '\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    if title and not re.search(r'^# ', text, re.M):
        text = f'# {title}\n\n{text}'
    return text + '\n'
