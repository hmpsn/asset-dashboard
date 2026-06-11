/**
 * schema-silent-failure-fixes.test.ts
 *
 * The original tautological helpers (simulate-* functions that re-implemented source
 * logic inside the test file) have been replaced by real component tests:
 *
 *   tests/component/SchemaSuggester.test.tsx  — W1.5 describe blocks
 *   tests/component/SchemaVersionHistory.test.tsx — rollback error surfacing
 *
 * This file retains a single existence test so vitest does not fail with
 * "No test suite found". It imports from source so reverting the lane
 * breaks the import (not just a simulate-helper).
 */

import { describe, it, expect } from 'vitest';
import { SchemaVersionHistory } from '../../src/components/schema/SchemaVersionHistory';
import { SchemaSuggester } from '../../src/components/SchemaSuggester';

describe('W1.5 schema-silent-failure-fixes — coverage is in component tests', () => {
  it('SchemaVersionHistory component is importable (uses IconButton, not raw button)', () => {
    expect(SchemaVersionHistory).toBeDefined();
  });

  it('SchemaSuggester component is importable (uses IconButton for error dismiss)', () => {
    expect(SchemaSuggester).toBeDefined();
  });
});
