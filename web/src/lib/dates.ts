/**
 * Dates on screen: day/month/year and a 24-hour clock, in Israel time, whatever the interface
 * language. A plain date (2026-11-04) is rearranged as it is, never shifted by a time zone.
 * A timestamp without a zone (SQLite's 2026-11-04 09:25:35) is read as UTC, as the server stores it.
 */
const TZ = 'Asia/Jerusalem';
const PLAIN = /^(\d{4})-(\d{2})-(\d{2})$/;

function toDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  let s = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parts(d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
}

/** 04/11/2026. Empty for no value. Text that is not a date comes back as it was. */
export function showDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') {
    const m = PLAIN.exec(value.trim());
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = toDate(value);
  if (!d) return String(value);
  const p = parts(d);
  return `${p.day}/${p.month}/${p.year}`;
}

/** 04/11/2026 11:25. A plain date shows without a time. */
export function showDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string' && PLAIN.test(value.trim())) return showDate(value);
  const d = toDate(value);
  if (!d) return String(value);
  const p = parts(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
