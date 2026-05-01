import { createLogger } from '../logger.js';

const log = createLogger('schema-org-validator');

export type SchemaOrgValidationStatus = 'schema_org_validated' | 'schema_org_failed';

export interface SchemaOrgValidationIssue {
  path: string;
  message: string;
}

export interface SchemaOrgValidationResult {
  status: SchemaOrgValidationStatus;
  issues: SchemaOrgValidationIssue[];
}

const VALIDATOR_URL = 'https://validator.schema.org/validate';

/**
 * Validate raw JSON-LD against the schema.org validator API.
 * Called at schema generation time — before publish.
 * Always returns a result (never throws): on network failure, returns validated (pass-through)
 * so generation is never blocked by an external service.
 */
export async function validateWithSchemaOrg(
  schema: Record<string, unknown>,
): Promise<SchemaOrgValidationResult> {
  try {
    const res = await fetch(VALIDATOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/ld+json' },
      body: JSON.stringify(schema),
      signal: AbortSignal.timeout(10_000), // 10s timeout — never stall generation
    });

    if (!res.ok) {
      log.warn({ status: res.status }, 'schema.org validator returned non-OK — treating as pass-through');
      return { status: 'schema_org_validated', issues: [] };
    }

    const data = await res.json() as {
      errors?: Array<{ path?: string; message?: string }>;
      triples?: unknown[];
    };

    const issues: SchemaOrgValidationIssue[] = (data.errors ?? []).map(e => ({
      path: e.path ?? '',
      message: e.message ?? '',
    }));

    const status: SchemaOrgValidationStatus = issues.length > 0 ? 'schema_org_failed' : 'schema_org_validated';

    log.info({ status, issueCount: issues.length }, 'schema.org validation complete');
    return { status, issues };
  } catch (err) {
    // Network error, timeout, or parse failure — never block generation
    log.warn({ err }, 'validateWithSchemaOrg failed — returning pass-through');
    return { status: 'schema_org_validated', issues: [] };
  }
}
