import { all } from '../../core/db';
import { type ClientLedger, type LedgerEntry, clientLedger } from '../documents/balances';
import { clientDisplayName } from '../clients/display';
import { uploadService } from '../import';

/**
 * Client ledger (תוספת ה׳), reports module: every document and payment for every client with
 * activity in the period, in date order, with a running balance in ILS and in the document's own
 * currency. `clientLedger` (src/modules/documents/balances.ts) already computes the per-currency
 * running balance correctly (conversions, cancellations, source-document handling); this module
 * reuses it per client rather than duplicating that logic, and adds the ILS running balance on
 * top from each row's own ILS amount (`documents.total_ils_minor`, `payments.amount_ils_minor`).
 *
 * Per docs/currency-and-fx.md ("No revaluation of open balances"), an entry with no ILS amount
 * fixed yet (an open foreign-currency quote or demand) contributes nothing to the ILS running
 * balance; it appears once its receipt or tax invoice fixes a rate, the same rule every other ILS
 * figure in the app already follows.
 */

export interface ClientLedgerEntryWithIls extends LedgerEntry {
  debit_ils_minor: number | null;
  credit_ils_minor: number | null;
  balance_ils_minor: number;
}

export interface ClientLedgerReportRow {
  clientId: number;
  clientName: string;
  ledger: Omit<ClientLedger, 'entries'> & { entries: ClientLedgerEntryWithIls[] };
  closingIlsMinor: number;
  /**
   * R17 task 7: documents uploaded from another system (SUMIT, Wave, other), labeled "Issued in
   * <source>". Listed separately rather than merged into `ledger`'s running balance: that balance
   * reconciles Open Ledger IL's own document-and-payment chain, a different kind of record from an
   * already-settled amount carried over from a prior system.
   */
  externalDocuments: Awaited<ReturnType<typeof uploadService.listExternalDocuments>>;
}

export interface ClientLedgersReport {
  from: string;
  to: string;
  clients: ClientLedgerReportRow[];
}

interface DocIlsInfo {
  ilsMinor: number | null;
  totalMinor: number;
}

async function documentIlsAmounts(db: D1Database, ids: number[]): Promise<Map<number, DocIlsInfo>> {
  const map = new Map<number, DocIlsInfo>();
  if (ids.length === 0) return map;
  const rows = await all<{ id: number; total_ils_minor: number | null; currency: string; total_minor: number }>(
    db,
    `SELECT id, total_ils_minor, currency, total_minor FROM documents WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  );
  for (const r of rows) {
    map.set(r.id, { ilsMinor: r.total_ils_minor ?? (r.currency === 'ILS' ? r.total_minor : null), totalMinor: r.total_minor });
  }
  return map;
}

/** Client ids with at least one bookkeeping document (final or cancelled, not a quote) dated in the period. */
async function activeClientIds(db: D1Database, from: string, to: string): Promise<{ id: number; name: string }[]> {
  const rows = await all<{ id: number; name_en: string; name_he: string | null }>(
    db,
    `SELECT DISTINCT c.id, c.name_en, c.name_he
     FROM clients c JOIN documents d ON d.client_id = c.id
     JOIN document_types dt ON dt.code = d.type
     WHERE d.status IN ('final', 'cancelled') AND dt.kind <> 'quote' AND d.date BETWEEN ? AND ?`,
    from,
    to,
  );
  return rows.map((r) => ({ id: r.id, name: clientDisplayName(r, 'en') })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function clientLedgersReport(db: D1Database, from: string, to: string): Promise<ClientLedgersReport> {
  const clients = await activeClientIds(db, from, to);
  const rows: ClientLedgerReportRow[] = [];

  for (const c of clients) {
    const ledger = await clientLedger(db, c.id, from, to);
    const docIds = [...new Set(ledger.entries.filter((e) => e.kind === 'document').map((e) => e.document_id))];
    const ilsByDoc = await documentIlsAmounts(db, docIds);

    let runningIls = 0;
    const entries: ClientLedgerEntryWithIls[] = ledger.entries.map((e) => {
      let debitIls: number | null = null;
      let creditIls: number | null = null;
      if (e.kind === 'document') {
        const info = ilsByDoc.get(e.document_id);
        // Only when the entry's debit is the document's full total, not reduced because it
        // replaces a converted source demand (documents/balances.ts clientLedger): the ILS
        // amount on record is for the whole document, and there is no reliable way to split it
        // proportionally onto a partial debit, so that narrower case is left out of the ILS
        // running balance rather than guessed at.
        if (info && info.ilsMinor !== null && Math.abs(e.debit_minor) === info.totalMinor) {
          debitIls = e.debit_minor >= 0 ? info.ilsMinor : -info.ilsMinor;
          runningIls += debitIls;
        }
      } else if (e.amount_ils_minor !== undefined && e.amount_ils_minor !== null && e.credit_minor !== 0) {
        creditIls = e.amount_ils_minor;
        runningIls -= creditIls;
      }
      return { ...e, debit_ils_minor: debitIls, credit_ils_minor: creditIls, balance_ils_minor: runningIls };
    });

    const externalDocuments = await uploadService.listExternalDocuments(db, { clientId: c.id, from, to });
    rows.push({ clientId: c.id, clientName: c.name, ledger: { ...ledger, entries }, closingIlsMinor: runningIls, externalDocuments });
  }

  return { from, to, clients: rows };
}
