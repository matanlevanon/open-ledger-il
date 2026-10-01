import { z } from 'zod';

/** At most this many copy addresses on one email. */
export const MAX_CC = 10;

const emailCheck = z.string().email();

/** Splits a list typed as "a@x.com, b@y.com" (commas, semicolons or spaces) into addresses. */
export function splitCc(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A copy list as stored: trimmed, valid addresses, no repeats, joined with ", ". Empty becomes
 * null. Used for the account setting and the client field.
 */
export const ccListText = z
  .string()
  .max(2000)
  .nullish()
  .transform((v, ctx) => {
    // Absent stays absent, so a partial update leaves the stored list alone.
    if (v === undefined) return undefined;
    const list = dedupe(splitCc(v));
    const bad = list.find((a) => !emailCheck.safeParse(a).success);
    if (bad) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${bad}" is not a valid email.` });
      return z.NEVER;
    }
    if (list.length > MAX_CC) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Up to ${MAX_CC} copy addresses.` });
      return z.NEVER;
    }
    return list.length > 0 ? list.join(', ') : null;
  });

/** Drops repeats, case-insensitive, keeping the first spelling. */
export function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The final copy list: no repeats, never the To address, at most MAX_CC. */
export function finalCc(to: string, ...lists: string[][]): string[] {
  return dedupe(lists.flat()).filter((a) => a.toLowerCase() !== to.toLowerCase()).slice(0, MAX_CC);
}
