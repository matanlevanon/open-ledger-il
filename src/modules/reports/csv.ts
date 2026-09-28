/** A minimal RFC 4180 writer: quotes a field only when it needs it, CRLF line endings. */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvField).join(','));
  return lines.join('\r\n') + '\r\n';
}
