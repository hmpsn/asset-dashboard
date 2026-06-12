import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_JOB_TYPES,
} from '../../shared/types/background-jobs.js';
import { BACKGROUND_JOB_LIFECYCLE_MATRIX } from '../helpers/background-job-test-matrix.js';
import { readProjectFile } from '../helpers/source-contracts.js';

describe('background-job coverage contract', () => {
  it('maps every registered background job type to at least one lifecycle signal file', () => {
    const registeredTypes = Object.values(BACKGROUND_JOB_TYPES).sort();
    const mappedTypes = Object.keys(BACKGROUND_JOB_LIFECYCLE_MATRIX).sort();
    expect(mappedTypes).toEqual(registeredTypes);

    for (const type of registeredTypes) {
      const entry = BACKGROUND_JOB_LIFECYCLE_MATRIX[type];
      expect(entry).toBeDefined();
      expect(entry.coverageSignals.length).toBeGreaterThan(0);
      expect(entry.expectedLabel.length).toBeGreaterThan(0);
      expect(typeof entry.expectedCancellable).toBe('boolean');
      expect(['ephemeral', 'domain-store', 'domain-store-and-result']).toContain(entry.expectedResultBehavior);
    }
  });

  it('keeps each lifecycle signal file present and anchored to the expected job type', () => {
    for (const [jobType, entry] of Object.entries(BACKGROUND_JOB_LIFECYCLE_MATRIX)) {
      for (const signal of entry.coverageSignals) {
        const source = readProjectFile(signal.file);
        expect(
          signal.mustContainOneOf.some(token => source.includes(token)),
          `${signal.file} should reference ${jobType}`,
        ).toBe(true);
      }
    }
  });

  it('mounts client routes inside BackgroundTaskProvider for public job tracking', () => {
    const appSource = readProjectFile('src/App.tsx');

    expect(appSource).toContain('function ClientRouteShell({ betaMode = false }: { betaMode?: boolean })');
    expect(appSource).toContain('<BackgroundTaskProvider workspaceId={workspaceId} publicMode>');
    expect(appSource).toContain('<Route path="/client/beta/:workspaceId/*" element={<ClientRouteShell betaMode />} />');
    expect(appSource).toContain('<Route path="/client/:workspaceId/*" element={<ClientRouteShell />} />');
  });
});
