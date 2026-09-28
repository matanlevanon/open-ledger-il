/** Shared shapes for the unified-file and PCN874 exports. */

export interface SeriesSummary {
  seriesId: string;
  docType: string;
  count: number;
  firstNumber: number;
  lastNumber: number;
}

/**
 * The per-export validation report (runs/R13-exports.md: "record counts, totals, first and last
 * numbers per series"). `warnings` carries anything a reviewer must see before filing, chiefly
 * unconfirmed document-type codes and stub record layouts.
 */
export interface ValidationReport {
  from: string;
  to: string;
  recordCounts: Record<string, number>;
  totalRecords: number;
  totalIlsMinor: number;
  series: SeriesSummary[];
  warnings: string[];
  layoutStatus: 'stub' | 'verified';
}
