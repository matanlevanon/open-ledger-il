import { unzipSync } from 'fflate';
import { ValidationError } from '../../core/errors';

export interface UnifiedFileParts {
  iniText: string;
  bkmvdataText: string;
}

/** Decodes unified-file bytes as Windows-1255 (the ITA's own encoding), falling back to UTF-8
 * when the runtime has no Windows-1255 table (some minimal ICU builds only ship Unicode). */
function decodeIsraeliText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('windows-1255').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function findEntry(files: Record<string, Uint8Array>, suffix: string): Uint8Array | null {
  const name = Object.keys(files).find((n) => n.toLowerCase().endsWith(suffix.toLowerCase()) && !n.endsWith('/'));
  return name ? files[name]! : null;
}

/** Extracts INI.TXT and BKMVDATA.TXT from an ITA unified-file (מבנה אחיד) ZIP. */
export function extractUnifiedFile(zipBytes: ArrayBuffer): UnifiedFileParts {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(zipBytes));
  } catch {
    throw new ValidationError('This file is not a readable ZIP archive.');
  }
  const ini = findEntry(files, 'INI.TXT');
  const bkmvdata = findEntry(files, 'BKMVDATA.TXT');
  if (!ini || !bkmvdata) {
    throw new ValidationError('The ZIP must contain INI.TXT and BKMVDATA.TXT (the SUMIT unified-file export).');
  }
  return { iniText: decodeIsraeliText(ini), bkmvdataText: decodeIsraeliText(bkmvdata) };
}
