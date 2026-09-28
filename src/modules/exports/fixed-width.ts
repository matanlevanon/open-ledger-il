import { ValidationError } from '../../core/errors';

/**
 * Fixed-width field helpers for the unified-file and PCN874 exports.
 *
 * The ITA spec (specs/unified-file/) is not in the repo yet (see codes.ts and
 * unified-file/records.ts), so the actual column widths used by the record builders are
 * placeholders. These helpers themselves are generic and not spec-dependent: right-aligned,
 * zero-padded for numbers; left-aligned, space-padded for text; every value truncated or
 * rejected once it cannot fit, never silently misaligning the rest of the line.
 */

/** Left-aligns text, space-padded to `width`. Throws if the text is longer than `width`. */
export function padAlpha(value: string, width: number): string {
  if (value.length > width) {
    throw new ValidationError(`Value "${value}" is longer than the ${width}-character field.`);
  }
  return value.padEnd(width, ' ');
}

/** Right-aligns a non-negative integer, zero-padded to `width`. */
export function padNumeric(value: number, width: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(`Value must be a non-negative integer, got ${value}.`);
  }
  const digits = String(value);
  if (digits.length > width) {
    throw new ValidationError(`Value ${value} does not fit in the ${width}-digit field.`);
  }
  return digits.padStart(width, '0');
}

/** Signed amount in minor units as a fixed-width digit string plus a trailing sign character. */
export function padSignedMinor(amountMinor: number, width: number): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new ValidationError(`Amount must be an integer in minor units, got ${amountMinor}.`);
  }
  const sign = amountMinor < 0 ? '-' : '+';
  const digits = String(Math.abs(amountMinor));
  if (digits.length > width) {
    throw new ValidationError(`Amount ${amountMinor} does not fit in the ${width}-digit field.`);
  }
  return digits.padStart(width, '0') + sign;
}

/** 'YYYY-MM-DD' to the 8-digit 'YYYYMMDD' the ITA formats use. */
export function padDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`Date must be YYYY-MM-DD, got "${value}".`);
  return value.replaceAll('-', '');
}

/** Blank alpha filler, for a field the record needs to reserve but this export never populates. */
export function blank(width: number): string {
  return ' '.repeat(width);
}

export interface FixedWidthField {
  value: string;
  width: number;
}

/** Concatenates already-padded fields and checks each one is exactly its declared width. */
export function renderLine(fields: FixedWidthField[]): string {
  for (const f of fields) {
    if (f.value.length !== f.width) {
      throw new ValidationError(`Field "${f.value}" is ${f.value.length} characters, expected ${f.width}.`);
    }
  }
  return fields.map((f) => f.value).join('');
}
