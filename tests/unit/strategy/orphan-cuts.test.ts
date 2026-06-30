/**
 * orphan-cuts.test.ts
 *
 * Regression guard for the P4 Lane D orphan deletion (strategy-redesign-phase-4).
 * Asserts that the 4 deleted component files no longer exist on disk, that the
 * strategy barrel no longer re-exports them, and that the intentionally-kept
 * components (IntelligenceSignals, LostQueryRecoveryCard) remain intact.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../');
const strategyDir = path.join(root, 'src/components/strategy');
const barrelPath = path.join(strategyDir, 'index.ts');

describe('P4 Lane D orphan-cuts regression', () => {
  describe('deleted files must not exist on disk', () => {
    it('OpportunitiesList.tsx is gone', () => {
      expect(fs.existsSync(path.join(strategyDir, 'OpportunitiesList.tsx'))).toBe(false);
    });

    it('RequestedKeywordTriage.tsx is gone', () => {
      expect(fs.existsSync(path.join(strategyDir, 'RequestedKeywordTriage.tsx'))).toBe(false);
    });

    it('DecisionQueue.tsx is gone', () => {
      expect(fs.existsSync(path.join(strategyDir, 'DecisionQueue.tsx'))).toBe(false);
    });

    it('buildOpportunityRows.ts is gone', () => {
      expect(fs.existsSync(path.join(strategyDir, 'buildOpportunityRows.ts'))).toBe(false);
    });
  });

  describe('strategy barrel must not re-export deleted symbols', () => {
    let barrelContent: string;

    beforeAll(() => {
      barrelContent = fs.readFileSync(barrelPath, 'utf8');
    });

    it('barrel does not export OpportunitiesList', () => {
      expect(barrelContent).not.toMatch(/OpportunitiesList/);
    });

    it('barrel does not export RequestedKeywordTriage', () => {
      expect(barrelContent).not.toMatch(/RequestedKeywordTriage/);
    });

    it('barrel does not export DecisionQueue', () => {
      expect(barrelContent).not.toMatch(/DecisionQueue/);
    });
  });

  describe('KEEP — intentionally-retained components must still exist', () => {
    it('IntelligenceSignals.tsx still exists', () => {
      expect(fs.existsSync(path.join(strategyDir, 'IntelligenceSignals.tsx'))).toBe(true);
    });

    it('LostQueryRecoveryCard.tsx still exists', () => {
      expect(fs.existsSync(path.join(strategyDir, 'LostQueryRecoveryCard.tsx'))).toBe(true);
    });
  });
});
