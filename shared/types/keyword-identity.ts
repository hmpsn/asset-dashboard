export const KEYWORD_IDENTITY_VERSIONS = {
  V1: 'v1',
  V2: 'v2',
} as const;

export type KeywordIdentityVersion =
  typeof KEYWORD_IDENTITY_VERSIONS[keyof typeof KEYWORD_IDENTITY_VERSIONS];

export const KEYWORD_IDENTITY_STORES = [
  'tracked_keywords',
  'site_keyword_metrics',
  'local_visibility_snapshots',
  'serp_snapshots',
  'keyword_feedback',
  'content_gap_votes',
  'keyword_metrics_cache',
] as const;

export type KeywordIdentityStore = typeof KEYWORD_IDENTITY_STORES[number];

/** Raw remains display/provider authority; v1 and v2 are comparison keys only. */
export interface KeywordIdentity {
  raw: string;
  v1: string;
  v2: string;
}

/** Internal-only metadata composed with tracked rows by table/KCC readers. */
export interface TrackedKeywordIdentityMetadata {
  sourceGapKeyV2?: string;
}

export const KEYWORD_IDENTITY_ALIAS_KINDS = {
  RAW_VARIANT: 'raw_variant',
  LEGACY_V1_ONLY: 'legacy_v1_only',
  ROLLBACK_PROJECTION: 'rollback_projection',
  V2_ONLY: 'v2_only',
} as const;

export type KeywordIdentityAliasKind =
  typeof KEYWORD_IDENTITY_ALIAS_KINDS[keyof typeof KEYWORD_IDENTITY_ALIAS_KINDS];

export const KEYWORD_IDENTITY_COLLISION_KINDS = {
  EQUIVALENT: 'equivalent',
  CONFLICTING: 'conflicting',
} as const;

export type KeywordIdentityCollisionKind =
  typeof KEYWORD_IDENTITY_COLLISION_KINDS[keyof typeof KEYWORD_IDENTITY_COLLISION_KINDS];

export const KEYWORD_IDENTITY_BACKFILL_MODES = {
  DRY_RUN: 'dry_run',
  APPLY: 'apply',
} as const;

export type KeywordIdentityBackfillMode =
  typeof KEYWORD_IDENTITY_BACKFILL_MODES[keyof typeof KEYWORD_IDENTITY_BACKFILL_MODES];

export interface KeywordIdentityStoreReport {
  scanned: number;
  inserted: number;
  updated: number;
  alreadyPresent: number;
  aliasesRetained: number;
  aliasesByKind: Record<KeywordIdentityAliasKind, number>;
  equivalentCollisions: number;
  conflictingCollisions: number;
  skipped: number;
  errors: number;
  provenanceUnresolved: number;
}

export interface KeywordIdentityBackfillError {
  store: KeywordIdentityStore;
  code: string;
  count: number;
  /** Bounded, redacted locators only; never raw keyword/provider content. */
  samples: Array<{
    workspaceId?: string;
    rowRefHash: string;
  }>;
}

export interface KeywordIdentityBackfillReport {
  schemaVersion: 1;
  identityVersion: typeof KEYWORD_IDENTITY_VERSIONS.V2;
  mode: KeywordIdentityBackfillMode;
  migrationHead: string;
  startedAt: string;
  completedAt: string;
  stores: Record<KeywordIdentityStore, KeywordIdentityStoreReport>;
  totals: KeywordIdentityStoreReport;
  errors: KeywordIdentityBackfillError[];
}

export interface RunKeywordIdentityBackfillOptions {
  mode: KeywordIdentityBackfillMode;
  workspaceId?: string;
}
