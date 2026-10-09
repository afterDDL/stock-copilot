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

export function safeErrorDetails(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof SnapshotError || error instanceof IfindError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return { code: 'snapshot_unavailable', message: 'Live iFinD snapshot unavailable; serving historical data.', retryable: true };
}
