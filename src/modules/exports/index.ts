import type { ModuleDef } from '../../core/module';
import { exportsRoutes } from './routes';

/** Unified-file and PCN874 exports (R13). Routes under /api/exports. */
export function createExportsModule(): ModuleDef {
  return {
    name: 'exports',
    basePath: '/exports',
    routes: exportsRoutes(),
  };
}

export const exportsModule = createExportsModule();

export { buildUnifiedFile, type UnifiedFileResult } from './unified-file/build';
export { buildPcn874, buildPcn874Row, type Pcn874Result } from './pcn874/build';
export { loadDocTypeCodes, resolveDocTypeCode, type DocTypeCodeRow, type ResolvedDocTypeCode } from './codes';
export { seriesSummaryForPeriod } from './validation';
export type { SeriesSummary, ValidationReport } from './types';
export { encodeWindows1255, decodeWindows1255, encodeIso88598, decodeIso88598 } from './encoding';
export { padAlpha, padNumeric, padSignedMinor, padDate, blank, renderLine } from './fixed-width';
