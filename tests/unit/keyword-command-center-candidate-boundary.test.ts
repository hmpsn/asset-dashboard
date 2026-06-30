import { describe, expect, it } from 'vitest';

import {
  __candidateKeysForTest,
  candidateSortForQuery,
  gateDiscoveryGaps,
  trackedKeywordMatchesFilter,
} from '../../server/keyword-command-center.js';
import * as candidateBoundary from '../../server/domains/keyword-command-center/candidate-boundary.js';

describe('keyword-command-center candidate boundary facade compatibility', () => {
  it('re-exports candidate helpers from the domain module by reference', () => {
    expect(__candidateKeysForTest).toBe(candidateBoundary.__candidateKeysForTest);
    expect(candidateSortForQuery).toBe(candidateBoundary.candidateSortForQuery);
    expect(gateDiscoveryGaps).toBe(candidateBoundary.gateDiscoveryGaps);
    expect(trackedKeywordMatchesFilter).toBe(candidateBoundary.trackedKeywordMatchesFilter);
  });
});
