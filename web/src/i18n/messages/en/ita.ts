/**
 * ITA feature strings (R16 task 16): the ITA connection card, the refused-invoices queue, the
 * allocation queue, and the documents-without-numbers table — everything under
 * web/src/features/ita/.
 */
export const ita = {
  'ita.title': 'ITA',

  // Refusal choices
  'ita.choice.cancel.label': 'Cancel invoice',
  'ita.choice.cancel.hint': 'Cancel it and tell the ITA.',
  'ita.choice.continue.label': 'Issue without number',
  'ita.choice.continue.hint': 'The client cannot deduct input VAT.',
  'ita.choice.reverseCharge.label': 'Reverse charge',
  'ita.choice.reverseCharge.hint': 'Needs the client to agree. Issues a zero-VAT invoice.',
  'ita.choice.furtherObjection.label': 'Request a hearing',
  'ita.choice.furtherObjection.hint': 'Send an objection, then request again after the hearing.',

  // ITA login callback
  'ita.callbackError.state': 'The ITA login link expired. Connect again.',
  'ita.callbackError.denied': 'The ITA login was cancelled. Connect again.',
  'ita.callbackError.default': 'The ITA login failed. Connect again.',
  'ita.connectedNotice': 'Connected to ITA.',

  // General
  'ita.loadingStatus': 'Loading ITA status.',
  'ita.requestFailed': 'Request failed.',
  'ita.notScheduled': 'not scheduled',
  'ita.documentFallback': 'Document {id}',
  'ita.docLabelDraft': '{type} draft {id}',
  'ita.docLabelNumbered': '{type} #{number}',
  'ita.forCustomer': 'for {name}',
  'ita.beforeVat': '· {amount} before VAT',

  // Allocation status labels
  'ita.status.pending': 'Retrying',
  'ita.status.stalled': 'Use the web app',
  'ita.status.failed': 'Needs a fix',

  // Connection card
  'ita.connection.title': 'Connection',
  'ita.renewal.test': 'Test renewal',
  'ita.renewal.running': 'Renewing…',
  'ita.renewal.ok': 'The ITA renewed the login. The call left from {from}.',
  'ita.renewal.failed': 'The ITA refused the renewal. {reason} The call left from {from}.',
  'ita.connection.notConnected': 'Not connected.',
  'ita.connection.active': 'Connected to {environment}. Login ends in {days} days.',
  'ita.connection.reconnectRequired': 'Reconnect needed on {environment}.',
  'ita.connection.connectToIta': 'Connect to ITA',
  'ita.connection.connectAgain': 'Connect again',
  'ita.connection.environmentHint': 'Environment: {environment}. Sign in with your ITA user code and one-time code.',
  'ita.banner.reconnectRequired': 'The ITA login stopped working. Connect again to get allocation numbers.',
  'ita.banner.reloginSoon': 'Your ITA login ends in {days} days. Connect again now.',

  // Refused invoices card
  'ita.refused.title': 'Refused invoices',
  'ita.refused.none': 'No refused invoices.',
  'ita.refused.hearingRequested': 'Hearing requested.',
  'ita.refused.openPortal': 'Open the ITA portal',
  'ita.refused.requestAgain': 'Request again',
  'ita.refused.description': 'The ITA refused this invoice. Pick one choice.',

  // Allocation queue card
  'ita.queue.title': 'Allocation queue',
  'ita.queue.none': 'Nothing waiting.',
  'ita.queue.triedTimes': 'Tried {attempts} times. Next try {next}.',
  'ita.queue.stalled': 'No answer for 24 hours. Request the number in the ITA web app and enter it here.',
  'ita.queue.failedDefault': 'The ITA rejected the request.',
  'ita.queue.retryNow': 'Retry now',
  'ita.queue.openWebApp': 'Open the ITA web app',
  'ita.queue.allocationNumberLabel': 'Allocation number',
  'ita.queue.noteLabel': 'Note',
  'ita.queue.notePlaceholder': 'From the ITA web app',
  'ita.queue.saveNumber': 'Save number',

  // Documents without numbers card
  'ita.withoutNumbers.title': 'Documents without numbers',
  'ita.withoutNumbers.none': 'Every qualifying tax invoice has a number.',
  'ita.withoutNumbers.colDocument': 'Document',
  'ita.withoutNumbers.colClient': 'Client',
  'ita.withoutNumbers.colDate': 'Date',
  'ita.withoutNumbers.colBeforeVat': 'Before VAT',
  'ita.withoutNumbers.colWhy': 'Why',
  'ita.withoutNumbers.issuedWithoutNumber': 'Issued without number',
};
