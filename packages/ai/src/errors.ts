// Error types thrown by @wobble/ai. Owned by #22.

export class AiError extends Error {
  override name = 'AiError';
  constructor(
    message: string,
    readonly details: { status?: number; model?: string; errorType?: string; cause?: unknown } = {},
  ) {
    super(message);
  }
}

/** Missing API key or another unusable configuration. */
export class AiConfigError extends AiError {
  override name = 'AiConfigError';
}

/** Non-retryable HTTP failure (400, 401, 403, 404, ...) or retries exhausted. */
export class AiHttpError extends AiError {
  override name = 'AiHttpError';
}

/** 402: the OpenRouter account is out of credits. Never retried. */
export class AiPaymentError extends AiError {
  override name = 'AiPaymentError';
}

/** HTTP 200 whose body carries an error object (provider failure). */
export class AiProviderError extends AiError {
  override name = 'AiProviderError';
}

/** The model refused (refusal text or content filter), twice. */
export class AiRefusedError extends AiError {
  override name = 'AiRefusedError';
}

/** The model returned unparseable JSON or JSON that failed the Zod schema, twice. */
export class AiInvalidError extends AiError {
  override name = 'AiInvalidError';
  constructor(
    message: string,
    details: AiError['details'] & { issues?: string[] } = {},
    readonly issues: string[] = details.issues ?? [],
  ) {
    super(message, details);
  }
}

/** The call would push spending past `budgetUsd`. Thrown before the request is sent. */
export class AiBudgetError extends AiError {
  override name = 'AiBudgetError';
}
