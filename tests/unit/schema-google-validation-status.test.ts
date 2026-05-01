/**
 * Unit tests for updateSchemaGoogleStatus — verifies DB roundtrip for
 * google_validation_status and google_validation_details, and confirms that
 * inspectUrlForRichResults returns null when no GSC token is available.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import type {
  GoogleValidationStatus,
  SchemaPublishEntry,
} from '../../server/schema-store.js';

let updateSchemaGoogleStatus: (
  entryId: string,
  workspaceId: string,
  status: GoogleValidationStatus,
  details?: Array<{ type: string; message: string }>,
) => void;
let recordSchemaPublish: (
  siteId: string,
  pageId: string,
  workspaceId: string,
  schema: Record<string, unknown>,
) => SchemaPublishEntry;
let getSchemaPublishEntry: (id: string) => SchemaPublishEntry | null;

const TEST_WORKSPACE_ID = 'ws-gv-test';
const TEST_SITE_ID = 'site-test';

/** IDs of entries created during this test run — cleaned up in afterAll. */
const createdEntryIds: string[] = [];

beforeAll(async () => {
  const mod = await import('../../server/schema-store.js');
  updateSchemaGoogleStatus = mod.updateSchemaGoogleStatus;
  recordSchemaPublish = mod.recordSchemaPublish;
  getSchemaPublishEntry = mod.getSchemaPublishEntry;
});

afterAll(() => {
  if (createdEntryIds.length > 0) {
    const placeholders = createdEntryIds.map(() => '?').join(', ');
    db.prepare(`DELETE FROM schema_publish_history WHERE id IN (${placeholders})`).run(...createdEntryIds);
  }
});

describe('updateSchemaGoogleStatus — DB roundtrip', () => {
  it('persists google_validated status', () => {
    const entry = recordSchemaPublish(TEST_SITE_ID, 'page-gv-test', TEST_WORKSPACE_ID, { '@type': 'WebPage' });
    createdEntryIds.push(entry.id);

    updateSchemaGoogleStatus(entry.id, entry.workspaceId, 'google_validated');

    const retrieved = getSchemaPublishEntry(entry.id);
    expect(retrieved?.googleValidationStatus).toBe('google_validated');
  });

  it('persists google_failed status with details', () => {
    const entry = recordSchemaPublish(TEST_SITE_ID, 'page-gv-fail', TEST_WORKSPACE_ID, { '@type': 'WebPage' });
    createdEntryIds.push(entry.id);

    updateSchemaGoogleStatus(entry.id, entry.workspaceId, 'google_failed', [
      { type: 'MISSING_FIELD', message: 'name is required' },
    ]);

    const retrieved = getSchemaPublishEntry(entry.id);
    expect(retrieved?.googleValidationStatus).toBe('google_failed');
    expect(retrieved?.googleValidationDetails?.[0]?.message).toBe('name is required');
  });
});

describe('inspectUrlForRichResults — no GSC token', () => {
  it('returns null for an unknown siteId (no token stored)', async () => {
    const { inspectUrlForRichResults } = await import('../../server/search-console.js');
    const result = await inspectUrlForRichResults(
      'no-such-site',
      'https://example.com/page',
      'https://example.com',
    );
    expect(result).toBeNull();
  });
});
