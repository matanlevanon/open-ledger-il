import { version } from '../package.json';

/** The running Ledger's version, from package.json at build time. The update check compares it to the latest release. */
export const APP_VERSION: string = version;
