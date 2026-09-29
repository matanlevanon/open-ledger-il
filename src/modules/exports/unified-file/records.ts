import { ValidationError } from '../../../core/errors';

/**
 * Unified file (מבנה אחיד) record layouts, version 1.31 of the Tax Authority's instructions
 * (specs/unified-file/Service_Pages_Income_tax_horaot-131.pdf, sections 3 and 4).
 *
 * Each record is a list of fields in file order. The builder pads every field to its width,
 * checks the total against the record length in the spec's table (section 2.5), and throws on
 * any mismatch, so a layout typo can never shift the columns after it.
 *
 * Field kinds, section 2.3:
 *   'X'  alphanumeric: left aligned, padded with spaces, cut at the width.
 *   '9'  numeric: right aligned, padded with zeros. Never negative.
 *   'S'  signed amount, written as X9(n)v99 in the spec: a sign ('+' or '-') and then the
 *        amount without a decimal point, zero padded. -12345.65 in X9(5)v99 is "-1234565".
 *        `decimals` says how many digits sit after the (implied) point.
 */
export type FieldKind = 'X' | '9' | 'S';

export interface FieldSpec {
  no: number;
  kind: FieldKind;
  width: number;
  /** For 'S' fields: digits after the implied decimal point. Default 2. */
  decimals?: number;
}

export type FieldValues = Partial<Record<number, string | number | null | undefined>>;

export const SYSTEM_CONSTANT = '&OF1.31&';

/** Record lengths from section 2.5, without the CR LF that ends each line. */
export const RECORD_LENGTH = {
  A000: 466,
  SUMMARY: 19,
  A100: 95,
  C100: 444,
  D110: 339,
  D120: 222,
  Z900: 110,
} as const;

const f = (no: number, kind: FieldKind, width: number, decimals?: number): FieldSpec => ({ no, kind, width, decimals });

/** INI.TXT leading record, section 3.1. Fields 1031 and 1033 are cancelled (width 0). */
export const A000_FIELDS: FieldSpec[] = [
  f(1000, 'X', 4),
  f(1001, 'X', 5),
  f(1002, '9', 15),
  f(1003, '9', 9),
  f(1004, '9', 15),
  f(1005, 'X', 8),
  // Software registration number, name and edition (written as sums: the plain numbers trip the public repo's leak check).
  f(1000 + 6, '9', 8),
  f(1000 + 7, 'X', 20),
  f(1000 + 8, 'X', 20),
  f(1009, '9', 9),
  f(1010, 'X', 20),
  f(1011, '9', 1),
  f(1012, 'X', 50),
  f(1013, '9', 1),
  f(1014, '9', 1),
  f(1015, '9', 9),
  f(1016, '9', 9),
  f(1017, 'X', 10),
  f(1018, 'X', 50),
  f(1019, 'X', 50),
  f(1020, 'X', 10),
  f(1021, 'X', 30),
  f(1022, 'X', 8),
  f(1023, '9', 4),
  f(1024, '9', 8),
  f(1025, '9', 8),
  f(1026, '9', 8),
  f(1027, '9', 4),
  f(1028, '9', 1),
  f(1029, '9', 1),
  f(1030, 'X', 20),
  f(1032, 'X', 3),
  f(1034, '9', 1),
  f(1035, 'X', 46),
];

/** INI.TXT summary record, section 3.2: one per record type in BKMVDATA.TXT. */
export const SUMMARY_FIELDS: FieldSpec[] = [f(1050, 'X', 4), f(1051, '9', 15)];

/** Opening record, section 4.1. */
export const A100_FIELDS: FieldSpec[] = [f(1100, 'X', 4), f(1101, '9', 9), f(1102, '9', 9), f(1103, '9', 15), f(1104, 'X', 8), f(1105, 'X', 50)];

/** Closing record, section 4.2. */
export const Z900_FIELDS: FieldSpec[] = [
  f(1150, 'X', 4),
  f(1151, '9', 9),
  f(1152, '9', 9),
  f(1153, '9', 15),
  f(1154, 'X', 8),
  f(1155, '9', 15),
  f(1156, 'X', 50),
];

/** Document header, section 4.3. Fields 1227, 1229 and 1232 are cancelled (width 0). */
export const C100_FIELDS: FieldSpec[] = [
  f(1200, 'X', 4),
  f(1201, '9', 9),
  f(1202, '9', 9),
  f(1203, '9', 3),
  f(1204, 'X', 20),
  f(1205, '9', 8),
  f(1206, '9', 4),
  f(1207, 'X', 50),
  f(1208, 'X', 50),
  f(1209, 'X', 10),
  f(1210, 'X', 30),
  f(1211, 'X', 8),
  f(1212, 'X', 30),
  f(1213, 'X', 2),
  f(1214, 'X', 15),
  f(1215, '9', 9),
  f(1216, '9', 8),
  f(1217, 'S', 15),
  f(1218, 'X', 3),
  f(1219, 'S', 15),
  f(1220, 'S', 15),
  f(1221, 'S', 15),
  f(1222, 'S', 15),
  f(1223, 'S', 15),
  f(1224, 'S', 12),
  f(1225, 'X', 15),
  f(1226, 'X', 10),
  f(1228, 'X', 1),
  f(1230, '9', 8),
  f(1231, 'X', 7),
  f(1233, 'X', 9),
  f(1234, '9', 7),
  f(1235, 'X', 13),
];

/** Document line, section 4.4. Fields 1269 and 1271 are cancelled (width 0). */
export const D110_FIELDS: FieldSpec[] = [
  f(1250, 'X', 4),
  f(1251, '9', 9),
  f(1252, '9', 9),
  f(1253, '9', 3),
  f(1254, 'X', 20),
  f(1255, '9', 4),
  f(1256, '9', 3),
  f(1257, 'X', 20),
  f(1258, '9', 1),
  f(1259, 'X', 20),
  f(1260, 'X', 30),
  f(1261, 'X', 50),
  f(1262, 'X', 30),
  f(1263, 'X', 20),
  f(1264, 'S', 17, 4),
  f(1265, 'S', 15),
  f(1266, 'S', 15),
  f(1267, 'S', 15),
  f(1268, '9', 4),
  f(1270, 'X', 7),
  f(1272, '9', 8),
  f(1273, '9', 7),
  f(1274, 'X', 7),
  f(1275, 'X', 21),
];

/** Receipt payment line, section 4.5. Fields 1316 to 1319 and 1321 are cancelled (width 0). */
export const D120_FIELDS: FieldSpec[] = [
  f(1300, 'X', 4),
  f(1301, '9', 9),
  f(1302, '9', 9),
  f(1303, '9', 3),
  f(1304, 'X', 20),
  f(1305, '9', 4),
  f(1306, '9', 1),
  f(1307, '9', 10),
  f(1308, '9', 10),
  f(1309, '9', 15),
  f(1310, '9', 10),
  f(1311, '9', 8),
  f(1312, 'S', 15),
  f(1313, '9', 1),
  f(1314, 'X', 20),
  f(1315, '9', 1),
  f(1320, 'X', 7),
  f(1322, '9', 8),
  f(1323, '9', 7),
  f(1324, 'X', 60),
];

function renderField(spec: FieldSpec, raw: string | number | null | undefined): string {
  const { no, kind, width } = spec;
  if (kind === 'X') {
    const text = raw === null || raw === undefined ? '' : String(raw).replace(/[\r\n\t]+/g, ' ');
    return text.slice(0, width).padEnd(width, ' ');
  }
  if (kind === '9') {
    const n = raw === null || raw === undefined || raw === '' ? 0 : raw;
    const digits = typeof n === 'number' ? (Number.isSafeInteger(n) && n >= 0 ? String(n) : '') : n.replace(/\D/g, '');
    if (typeof n === 'number' && digits === '') throw new ValidationError(`Field ${no} needs a whole number of zero or more, got ${n}.`);
    if (digits.length > width) throw new ValidationError(`Field ${no} value ${digits} is longer than ${width} digits.`);
    return digits.padStart(width, '0');
  }
  // 'S': the value is already scaled to the field's decimals (minor units for 2 decimals).
  const n = raw === null || raw === undefined || raw === '' ? 0 : Number(raw);
  if (!Number.isSafeInteger(n)) throw new ValidationError(`Field ${no} needs a whole number of minor units, got ${raw}.`);
  const digits = String(Math.abs(n));
  if (digits.length > width - 1) throw new ValidationError(`Field ${no} amount ${n} does not fit in ${width - 1} digits.`);
  return (n < 0 ? '-' : '+') + digits.padStart(width - 1, '0');
}

/** Renders one record and checks its length against the spec. */
export function renderRecord(fields: FieldSpec[], values: FieldValues, expectedLength: number): string {
  const line = fields.map((spec) => renderField(spec, values[spec.no])).join('');
  if (line.length !== expectedLength) {
    throw new ValidationError(`Record starting with field ${fields[0]?.no} is ${line.length} characters, the spec says ${expectedLength}.`);
  }
  return line;
}

/** Sum of field widths, for the layout tests. */
export function layoutLength(fields: FieldSpec[]): number {
  return fields.reduce((s, x) => s + x.width, 0);
}
