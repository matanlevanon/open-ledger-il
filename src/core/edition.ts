import type { Env } from '../env';

/**
 * R48: the Ledger edition, the Worker variable LEDGER_EDITION. `single` (the default) is one
 * person or one company and their staff. `firm` is an accounting firm that runs many client
 * businesses in one Ledger, where the owners of two businesses are strangers to each other.
 */
export type Edition = 'single' | 'firm';

export function ledgerEdition(env: Pick<Env, 'LEDGER_EDITION'> | undefined): Edition {
  return (env?.LEDGER_EDITION ?? '').trim().toLowerCase() === 'firm' ? 'firm' : 'single';
}
