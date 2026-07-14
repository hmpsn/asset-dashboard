export class BrandGenerationPersistenceContractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BrandGenerationPersistenceContractError';
  }
}

export class BrandGenerationNotFoundError extends Error {
  readonly resource: 'run' | 'item' | 'command' | 'attempt' | 'deliverable';

  constructor(resource: BrandGenerationNotFoundError['resource']) {
    super(`Brand generation ${resource} was not found`);
    this.name = 'BrandGenerationNotFoundError';
    this.resource = resource;
  }
}

export class BrandGenerationIdempotencyConflictError extends Error {
  readonly commandKind: 'start' | 'resume' | 'revision';

  constructor(commandKind: BrandGenerationIdempotencyConflictError['commandKind']) {
    super('Brand generation idempotency key was already used for different business inputs');
    this.name = 'BrandGenerationIdempotencyConflictError';
    this.commandKind = commandKind;
  }
}

export class BrandGenerationRevisionConflictError extends Error {
  readonly resource: 'run' | 'item' | 'deliverable';
  readonly expectedRevision: number;
  readonly actualRevision: number | null;

  constructor(
    resource: BrandGenerationRevisionConflictError['resource'],
    expectedRevision: number,
    actualRevision: number | null,
  ) {
    super(`Brand generation ${resource} revision changed`);
    this.name = 'BrandGenerationRevisionConflictError';
    this.resource = resource;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class BrandGenerationApprovedDeliverableError extends Error {
  readonly deliverableId: string;

  constructor(deliverableId: string) {
    super('Approved brand deliverables must be returned to draft before generation');
    this.name = 'BrandGenerationApprovedDeliverableError';
    this.deliverableId = deliverableId;
  }
}

export type BrandGenerationBudgetDimension =
  | 'providerCalls'
  | 'inputTokens'
  | 'outputTokens'
  | 'estimatedCostMicros'
  | 'maxConcurrency';

export class BrandGenerationBudgetExceededError extends Error {
  readonly dimension: BrandGenerationBudgetDimension;
  readonly requested: number;
  readonly limit: number;

  constructor(dimension: BrandGenerationBudgetDimension, requested: number, limit: number) {
    super(`Brand generation ${dimension} budget exceeds its allowed limit`);
    this.name = 'BrandGenerationBudgetExceededError';
    this.dimension = dimension;
    this.requested = requested;
    this.limit = limit;
  }
}

export class BrandGenerationConcurrencyLimitError extends Error {
  readonly runningAttempts: number;
  readonly maxConcurrency: number;

  constructor(runningAttempts: number, maxConcurrency: number) {
    super('Brand generation concurrency limit is already fully reserved');
    this.name = 'BrandGenerationConcurrencyLimitError';
    this.runningAttempts = runningAttempts;
    this.maxConcurrency = maxConcurrency;
  }
}

export class BrandGenerationAttemptCheckpointConflictError extends Error {
  constructor() {
    super('Brand generation attempt checkpoint already belongs to different work');
    this.name = 'BrandGenerationAttemptCheckpointConflictError';
  }
}

export class BrandGenerationCursorError extends Error {
  constructor(message = 'Brand generation item cursor is invalid or stale', options?: ErrorOptions) {
    super(message, options);
    this.name = 'BrandGenerationCursorError';
  }
}

export const BRAND_GENERATION_PRECONDITION_REASONS = [
  'feature_disabled',
  'intake_changed',
  'voice_not_finalized',
  'voice_changed',
  'invalid_selection',
  'invalid_lifecycle',
  'missing_evidence',
  'input_too_large',
  'approved_deliverable',
] as const;

export type BrandGenerationPreconditionReason =
  (typeof BRAND_GENERATION_PRECONDITION_REASONS)[number];

export class BrandGenerationPreconditionError extends Error {
  readonly reason: BrandGenerationPreconditionReason;

  constructor(reason: BrandGenerationPreconditionReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BrandGenerationPreconditionError';
    this.reason = reason;
  }
}

export class BrandGenerationFeatureDisabledError extends BrandGenerationPreconditionError {
  constructor() {
    super('feature_disabled', 'Brand deliverable generation is not enabled for this workspace');
    this.name = 'BrandGenerationFeatureDisabledError';
  }
}
