import type { DriveSource, DriveFile } from './drive';
import type { Extractor, ExtractInput } from './extractor';
import type { ExtractedExpense } from './types';

/**
 * Fakes for external services (runs/_common.md: "no test calls the internet"). Tests build a
 * module with `createExpensesModule(() => ({ drive, extractor, fx }))`. For `fx`, tests pass the
 * fx module's `FxRates` over a `FakeFxHistory`, so the one rate rule runs in tests too.
 */

export class FakeDriveSource implements DriveSource {
  constructor(
    private readonly files: Record<string, { file: DriveFile; bytes: ArrayBuffer }[]> = {},
    private readonly monthFolders: Record<string, string> = {},
    /** Index sheets by `${rootFolderId}/${yearMonth}`: the spreadsheet id and its rows as displayed. */
    private readonly sheets: Record<string, { id: string; rows: string[][] }> = {},
  ) {}

  /** Adds a file to a folder after construction, as the owner dropping a new receipt into Drive. */
  addFile(folderId: string, file: DriveFile, bytes: ArrayBuffer): void {
    (this.files[folderId] ??= []).push({ file, bytes });
  }

  async findIndexSheet(rootFolderId: string, yearMonth: string, _title?: string): Promise<string | null> {
    return this.sheets[`${rootFolderId}/${yearMonth}`]?.id ?? null;
  }

  async readSheet(spreadsheetId: string): Promise<string[][]> {
    const hit = Object.values(this.sheets).find((s) => s.id === spreadsheetId);
    if (!hit) throw new Error(`FakeDriveSource has no sheet ${spreadsheetId}`);
    return hit.rows;
  }

  async findMonthFolder(rootFolderId: string, yearMonth: string): Promise<string | null> {
    return this.monthFolders[`${rootFolderId}/${yearMonth}`] ?? null;
  }

  async listFiles(folderId: string): Promise<DriveFile[]> {
    return (this.files[folderId] ?? []).map((f) => f.file);
  }

  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    for (const entries of Object.values(this.files)) {
      const hit = entries.find((f) => f.file.id === fileId);
      if (hit) return hit.bytes;
    }
    throw new Error(`FakeDriveSource has no file ${fileId}`);
  }
}

/** Returns a fixed result, or looks one up by filename when several fixtures are queued. */
export class FakeExtractor implements Extractor {
  constructor(private readonly byFilename: Record<string, ExtractedExpense> = {}) {}

  async extract(input: ExtractInput): Promise<ExtractedExpense> {
    const found = this.byFilename[input.filename];
    if (!found) throw new Error(`FakeExtractor has no fixture for "${input.filename}"`);
    return found;
  }
}
