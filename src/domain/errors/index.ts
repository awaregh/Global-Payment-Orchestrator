export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 422, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} with id '${id}' not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(key: string) {
    super('IDEMPOTENCY_CONFLICT', `Request with idempotency key '${key}' is already in flight`, 409);
    this.name = 'IdempotencyConflictError';
  }
}

export class ProviderError extends AppError {
  constructor(providerId: string, message: string, errorCode?: string) {
    super('PROVIDER_ERROR', `Provider '${providerId}' failed: ${message}`, 502, { providerId, errorCode });
    this.name = 'ProviderError';
  }
}

export class NoAvailableProviderError extends AppError {
  constructor(reason: string) {
    super('NO_AVAILABLE_PROVIDER', `No payment provider available: ${reason}`, 503);
    this.name = 'NoAvailableProviderError';
  }
}

export class CircuitOpenError extends AppError {
  constructor(providerId: string) {
    super('CIRCUIT_OPEN', `Provider '${providerId}' circuit is open`, 503);
    this.name = 'CircuitOpenError';
  }
}

export class RefundError extends AppError {
  constructor(message: string) {
    super('REFUND_ERROR', message, 422);
    this.name = 'RefundError';
  }
}
