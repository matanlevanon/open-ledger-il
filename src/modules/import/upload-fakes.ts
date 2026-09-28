import type { ExternalDocExtractInput, ExternalDocExtractor } from './upload-extractor';
import { EMPTY_EXTRACTION, type ExtractedExternalDoc } from './upload-types';

/** Returns a fixed result by filename, or the empty extraction (manual entry) for anything else. */
export class FakeExternalDocExtractor implements ExternalDocExtractor {
  constructor(private readonly byFilename: Record<string, ExtractedExternalDoc> = {}) {}

  async extract(input: ExternalDocExtractInput): Promise<ExtractedExternalDoc> {
    return this.byFilename[input.filename] ?? EMPTY_EXTRACTION;
  }
}

/** Always throws, so tests can exercise the "extraction failed, review screen still opens" path. */
export class FailingExternalDocExtractor implements ExternalDocExtractor {
  async extract(_input: ExternalDocExtractInput): Promise<ExtractedExternalDoc> {
    throw new Error('extraction unavailable in this test');
  }
}
