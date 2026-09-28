import type { PaymentLinkSettings } from './settings';

/** Short, active English copy per CLAUDE.md. No em dashes, no semicolons. */

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function paymentLinksHtml(links: PaymentLinkSettings): string {
  const rows: string[] = [];
  if (links.stripe) rows.push(`<a href="${escapeHtml(links.stripe)}">Pay by card</a>`);
  if (links.paypal) rows.push(`<a href="${escapeHtml(links.paypal)}">Pay by PayPal</a>`);
  return rows.length === 0 ? '' : `<p>${rows.join(' | ')}</p>`;
}

function paymentLinksText(links: PaymentLinkSettings): string {
  const rows: string[] = [];
  if (links.stripe) rows.push(`Pay by card: ${links.stripe}`);
  if (links.paypal) rows.push(`Pay by PayPal: ${links.paypal}`);
  return rows.length === 0 ? '' : `\n${rows.join('\n')}\n`;
}

export function documentEmailHtml(
  clientName: string,
  displayNumber: string | null,
  links: PaymentLinkSettings,
  message: string | null,
  businessName: string,
): string {
  const name = escapeHtml(clientName);
  const number = displayNumber ? escapeHtml(displayNumber) : 'document';
  const note = message ? `<p>${escapeHtml(message)}</p>` : '';
  return `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5">
<p>Hello ${name},</p>
<p>Please find ${number} attached.</p>
${note}
${paymentLinksHtml(links)}
<p>Thank you,<br>${escapeHtml(businessName)}</p>
</body></html>`;
}

export function documentEmailText(
  clientName: string,
  displayNumber: string | null,
  links: PaymentLinkSettings,
  message: string | null,
  businessName: string,
): string {
  const number = displayNumber ?? 'document';
  const note = message ? `\n${message}\n` : '';
  return `Hello ${clientName},\n\nPlease find ${number} attached.\n${note}${paymentLinksText(links)}\nThank you,\n${businessName}\n`;
}

export function reminderEmailHtml(
  clientName: string,
  displayNumber: string | null,
  direction: 'before' | 'after',
  links: PaymentLinkSettings,
  businessName: string,
): string {
  const name = escapeHtml(clientName);
  const number = displayNumber ? escapeHtml(displayNumber) : 'your payment request';
  const line =
    direction === 'before'
      ? `This is a reminder that ${number} is due soon.`
      : `This is a reminder that ${number} is now overdue.`;
  return `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5">
<p>Hello ${name},</p>
<p>${line}</p>
${paymentLinksHtml(links)}
<p>Thank you,<br>${escapeHtml(businessName)}</p>
</body></html>`;
}

export function reminderEmailText(
  clientName: string,
  displayNumber: string | null,
  direction: 'before' | 'after',
  links: PaymentLinkSettings,
  businessName: string,
): string {
  const number = displayNumber ?? 'your payment request';
  const line = direction === 'before' ? `This is a reminder that ${number} is due soon.` : `This is a reminder that ${number} is now overdue.`;
  return `Hello ${clientName},\n\n${line}\n${paymentLinksText(links)}\nThank you,\n${businessName}\n`;
}
