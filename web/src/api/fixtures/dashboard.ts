import type { DashboardData } from '../dashboard';

/** VITE_MOCK=1 fixture for GET /api/dashboard. Invented names and figures, for layout work and tests only. */

const MONTHS = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const IN = [610000, 720000, 540000, 880000, 930000, 760000, 920000, 1140000, 860000, 1310000, 990000, 1420000];
const IMPORTED = [480000, 520000, 390000, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const OUT = [150000, 180000, 240000, 210000, 160000, 190000, 210000, 260000, 190000, 305000, 240000, 330000];

export const dashboardFixture: DashboardData = {
  today: '2026-09-28',
  overdueRequests: [
    { currency: 'ILS', count: 2, totalMinor: 480000 },
    { currency: 'USD', count: 1, totalMinor: 65000 },
  ],
  ceiling: { year: 2026, currency: 'ILS', limitMinor: 12283300, currentMinor: 8410000 },
  vatDue: { applicable: false, amountMinor: 0, currency: 'ILS' },
  ita: { connected: false, message: 'Connects after the switch to עוסק מורשה.' },
  cards: {
    overdue: {
      overdueRequests: [
        { currency: 'ILS', count: 2, totalMinor: 480000 },
        { currency: 'USD', count: 1, totalMinor: 65000 },
      ],
      openProformas: [{ currency: 'ILS', count: 1, totalMinor: 350000 }],
      items: [
        { documentId: 41, type: 'PR', typeNameEn: 'Payment Request', typeNameHe: 'דרישת תשלום', displayNumber: 'PR-0041', clientId: 3, clientNameEn: 'Acme Ltd', clientNameHe: 'אקמה בע"מ', date: '2026-07-01', dueDate: '2026-07-15', currency: 'ILS', remainingMinor: 300000, ilsMinor: 300000, daysOverdue: 75, bucket: '61-90' },
        { documentId: 44, type: 'PR', typeNameEn: 'Payment Request', typeNameHe: 'דרישת תשלום', displayNumber: 'PR-0044', clientId: 5, clientNameEn: 'Northwind Inc', clientNameHe: 'Northwind Inc', date: '2026-08-20', dueDate: '2026-09-03', currency: 'USD', remainingMinor: 65000, ilsMinor: 242000, daysOverdue: 25, bucket: '1-30' },
        { documentId: 46, type: 'PR', typeNameEn: 'Payment Request', typeNameHe: 'דרישת תשלום', displayNumber: 'PR-0046', clientId: 7, clientNameEn: 'Beta Studio', clientNameHe: 'בטא סטודיו', date: '2026-09-01', dueDate: '2026-09-15', currency: 'ILS', remainingMinor: 180000, ilsMinor: 180000, daysOverdue: 13, bucket: '1-30' },
        { documentId: 48, type: '300', typeNameEn: 'Pro Forma Invoice', typeNameHe: 'חשבון עסקה', displayNumber: '300-0012', clientId: 3, clientNameEn: 'Acme Ltd', clientNameHe: 'אקמה בע"מ', date: '2026-09-20', dueDate: '2026-10-05', currency: 'ILS', remainingMinor: 350000, ilsMinor: 350000, daysOverdue: -7, bucket: 'current' },
      ],
    },
    cashFlow: {
      from: '2025-10-01',
      to: '2026-09-28',
      months: MONTHS.map((month, i) => ({
        month,
        inflowIlsMinor: IN[i]! - IMPORTED[i]!,
        importedInflowIlsMinor: IMPORTED[i]!,
        outflowIlsMinor: -OUT[i]!,
        netIlsMinor: IN[i]! - OUT[i]!,
      })),
    },
    profitLoss: {
      from: '2025-10-01',
      to: '2026-09-28',
      months: MONTHS.map((month, i) => ({
        month,
        incomeIlsMinor: IN[i]! - IMPORTED[i]! + 30000,
        importedIncomeIlsMinor: IMPORTED[i]!,
        expensesIlsMinor: OUT[i]!,
        netIlsMinor: IN[i]! + 30000 - OUT[i]!,
      })),
    },
    incomeByMonth: {
      from: '2026-01-01',
      to: '2026-12-31',
      totalIlsMinor: 9210000,
      importedIlsMinor: 0,
      months: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m, i) => {
        const v = i < 9 ? IN[i + 3]! : 0;
        return { month: `2026-${m}`, issuedIlsMinor: v, importedIlsMinor: 0, totalIlsMinor: v };
      }),
    },
    topClients: {
      from: '2026-01-01',
      to: '2026-12-31',
      totalIlsMinor: 9210000,
      rows: [
        { key: 'client:3', nameEn: 'Acme Ltd', nameHe: 'אקמה בע"מ', ilsMinor: 3120000, byCurrency: { ILS: 3120000 }, count: 9 },
        { key: 'client:5', nameEn: 'Northwind Inc', nameHe: 'Northwind Inc', ilsMinor: 2240000, byCurrency: { USD: 604000 }, count: 6 },
        { key: 'client:7', nameEn: 'Beta Studio', nameHe: 'בטא סטודיו', ilsMinor: 1560000, byCurrency: { ILS: 1560000 }, count: 5 },
        { key: 'client:9', nameEn: 'Gamma Labs', nameHe: 'גמא מעבדות', ilsMinor: 980000, byCurrency: { ILS: 980000 }, count: 3 },
        { key: 'name:Delta Co', nameEn: 'Delta Co', nameHe: 'Delta Co', ilsMinor: 640000, byCurrency: { ILS: 640000 }, count: 2, imported: true },
      ],
      other: { key: 'other', nameEn: 'Other', nameHe: 'אחר', ilsMinor: 670000, byCurrency: { ILS: 520000, EUR: 36000 }, count: 4 },
    },
    topServices: {
      from: '2026-01-01',
      to: '2026-12-31',
      totalIlsMinor: 8570000,
      rows: [
        { key: 'item:1', nameEn: 'Monthly retainer', nameHe: 'ריטיינר חודשי', ilsMinor: 4800000, byCurrency: { ILS: 4800000 }, count: 16, quantityMilli: 16000 },
        { key: 'item:2', nameEn: 'Strategy workshop', nameHe: 'סדנת אסטרטגיה', ilsMinor: 1900000, byCurrency: { ILS: 1100000, USD: 216000 }, count: 5, quantityMilli: 5000 },
        { key: 'item:3', nameEn: 'Advisory hours', nameHe: 'שעות ייעוץ', ilsMinor: 1270000, byCurrency: { ILS: 1270000 }, count: 8, quantityMilli: 42000 },
        { key: 'line:Audit', nameEn: 'Audit', nameHe: 'Audit', ilsMinor: 600000, byCurrency: { ILS: 600000 }, count: 2, quantityMilli: 2000 },
      ],
      other: null,
    },
    expenseCategories: {
      from: '2026-01-01',
      to: '2026-12-31',
      totalIlsMinor: 2095000,
      rows: [
        { key: 'category:1', nameEn: 'Software', nameHe: 'Software', ilsMinor: 820000, byCurrency: { USD: 221000 }, count: 27 },
        { key: 'category:2', nameEn: 'Contractors', nameHe: 'Contractors', ilsMinor: 610000, byCurrency: { ILS: 610000 }, count: 4 },
        { key: 'category:3', nameEn: 'Travel', nameHe: 'Travel', ilsMinor: 300000, byCurrency: { ILS: 300000 }, count: 6 },
        { key: 'category:4', nameEn: 'Office', nameHe: 'Office', ilsMinor: 185000, byCurrency: { ILS: 185000 }, count: 9 },
        { key: 'category:none', nameEn: 'Uncategorized', nameHe: 'ללא קטגוריה', ilsMinor: 110000, byCurrency: { ILS: 110000 }, count: 3 },
      ],
      other: { key: 'other', nameEn: 'Other', nameHe: 'אחר', ilsMinor: 70000, byCurrency: { ILS: 70000 }, count: 2 },
    },
    yearComparison: {
      previousYear: { from: '2025-01-01', to: '2025-12-31', incomeIlsMinor: 7950000, expensesIlsMinor: 2210000, netIlsMinor: 5740000 },
      samePeriodLastYear: { from: '2025-01-01', to: '2025-09-28', incomeIlsMinor: 5890000, expensesIlsMinor: 1630000, netIlsMinor: 4260000 },
      yearToDate: { from: '2026-01-01', to: '2026-09-28', incomeIlsMinor: 9210000, expensesIlsMinor: 2095000, netIlsMinor: 7115000 },
    },
    aging: {
      buckets: [
        { bucket: 'current', count: 1, byCurrency: { ILS: 350000 }, ilsMinor: 350000 },
        { bucket: '1-30', count: 2, byCurrency: { ILS: 180000, USD: 65000 }, ilsMinor: 422000 },
        { bucket: '31-60', count: 0, byCurrency: {}, ilsMinor: 0 },
        { bucket: '61-90', count: 1, byCurrency: { ILS: 300000 }, ilsMinor: 300000 },
        { bucket: '90+', count: 0, byCurrency: {}, ilsMinor: 0 },
      ],
    },
  },
};
