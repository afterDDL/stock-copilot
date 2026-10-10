export class SnapshotError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code = 'snapshot_error', retryable = false) {
    super(message);
    this.name = 'SnapshotError';
    this.code = code;
    this.retryable = retryable;
  }
}

export class IfindError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code = 'ifind_error', retryable = false) {
    super(message);
    this.name = 'IfindError';
    this.code = code;
    this.retryable = retryable;
  }
}

export class AshareSearchError extends Error {
  readonly code = 'needs_narrowing';
  readonly reasonCode: string;

  constructor(reasonCode = 'unknown') {
    super('Candidate search requires narrower conditions.');
    this.name = 'AshareSearchError';
    this.reasonCode = reasonCode;
  }
}

export function safeErrorDetails(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof SnapshotError || error instanceof IfindError) {
    const code = /^[a-z][a-z0-9_]{0,47}$/.test(error.code) ? error.code : 'snapshot_unavailable';
    return {
      code,
      message: 'Live iFinD snapshot unavailable; serving historical data.',
      retryable: error.retryable,
    };
  }
  return { code: 'snapshot_unavailable', message: 'Live iFinD snapshot unavailable; serving historical data.', retryable: true };
}
