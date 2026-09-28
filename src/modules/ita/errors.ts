import { DomainError } from '../../core/errors';

/** The ITA login lapsed or was revoked. The owner signs in to the ITA again. */
export class ItaReconnectError extends DomainError {
  constructor(message = 'Reconnect to ITA to continue.') {
    super('ita_reconnect_required', message, 409);
  }
}

/** The ITA did not answer, or answered 5xx. */
export class ItaUnavailableError extends DomainError {
  constructor(message = 'The ITA service is not answering. Try again later.') {
    super('ita_unavailable', message, 502);
  }
}

/** The ITA answered with a response the client cannot read. */
export class ItaProtocolError extends DomainError {
  constructor(message: string) {
    super('ita_protocol_error', message, 502);
  }
}
