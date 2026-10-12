/**
 * R25: the safe Markdown subset for contract bodies. Every character of the source is escaped
 * before any markup is added, so a template can never inject HTML. Supported:
 *
 *   # Heading (levels 1 to 4)        **bold**   *italic*
 *   - bullet, 1. numbered            > quoted block (indented clauses)
 *   | a | b | pipe tables (a |---| row under the first row makes it a header)
 *   ---  a rule                      a blank line starts a new paragraph
 *   {{field_key}} a field. Alone on a line it renders as a block (a scope list, a signature box).
 *   {{field_key:fees}} the fee table of a scope field.
 */

export interface TokenHook {
  /** HTML for one field token. `block` is true when the token stands alone on its line. */
  (key: string, block: boolean): string;
}

const TOKEN = /\{\{\s*([a-z][a-z0-9_]*(?::[a-z]+)?)\s*\}\}/g;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Every field key named in a body, in order of first use. `key:fees` reads as `key`. */
export function tokensIn(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(TOKEN)) {
    const key = m[1]!.split(':')[0]!;
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

function inline(text: string, hook: TokenHook): string {
  // Tokens become placeholders first, so their HTML never passes through the bold and italic rules.
  const tokens: string[] = [];
  const marked = text.replace(TOKEN, (_m, key: string) => {
    tokens.push(key);
    return `\u0000${tokens.length - 1}\u0000`;
  });
  let html = escapeHtml(marked);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>');
  return html.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => hook(tokens[Number(i)]!, false));
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

const isSeparatorRow = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

function table(lines: string[], hook: TokenHook): string {
  const rows = lines.map(splitRow);
  let head: string[] | null = null;
  let body = rows;
  if (lines.length > 1 && isSeparatorRow(lines[1]!)) {
    head = rows[0]!;
    body = rows.slice(2);
  }
  const cells = (row: string[], tag: 'th' | 'td') => row.map((c) => `<${tag}>${inline(c, hook)}</${tag}>`).join('');
  return `<table class="md-table">${head ? `<thead><tr>${cells(head, 'th')}</tr></thead>` : ''}<tbody>${body.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('')}</tbody></table>`;
}

/** Renders the subset to HTML. Field tokens go through `hook`. */
export function renderMarkdown(source: string, hook: TokenHook): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const startsBlock = (line: string) =>
    /^\s*$/.test(line) || /^#{1,4}\s/.test(line) || /^\s*---\s*$/.test(line) || /^>\s?/.test(line) || /^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line) || /^\s*\|/.test(line);

  while (i < lines.length) {
    const line = lines[i]!;
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!, hook)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*---\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    const alone = /^\s*\{\{\s*([a-z][a-z0-9_]*(?::[a-z]+)?)\s*\}\}\s*$/.exec(line);
    if (alone) {
      out.push(hook(alone[1]!, true));
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) quoted.push(lines[i++]!.replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(quoted.join('\n'), hook)}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i]!)) items.push(lines[i++]!.replace(pattern, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it, hook)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(lines[i++]!);
      out.push(table(rows, hook));
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && !startsBlock(lines[i]!)) para.push(lines[i++]!);
    out.push(`<p>${para.map((p) => inline(p, hook)).join('<br>')}</p>`);
  }
  return out.join('\n');
}
