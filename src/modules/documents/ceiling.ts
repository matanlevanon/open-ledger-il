/**
 * Hook for the עוסק פטור ceiling (docs/legal-requirements.md, "Ceiling guard").
 * Finalize calls `check` before a receipt gets its number. R08 implements the guard and throws
 * a CEILING_CROSSING error to stop the receipt. Here: the interface and a pass-through.
 */
export interface CeilingGuard {
  /** Throws to block the receipt. `amountIls` is the receipt's ILS total in agorot. */
  check(amountIls: number, date: string): Promise<void>;
}

export const passThroughCeilingGuard: CeilingGuard = {
  async check() {},
};
