import { describe, it, expect } from 'vitest';

interface StateMachineConfig {
  /** Name of the entity (for test descriptions) */
  entity: string;
  /** All possible states */
  states: string[];
  /** Valid transitions as [from, to] pairs */
  validTransitions: Array<[from: string, to: string]>;
  /** Function to seed an entity in a given state, returns entity ID */
  seedFn: (state: string) => Promise<string> | string;
  /** Function to attempt a state transition */
  updateFn: (id: string, newState: string) => Promise<{ success: boolean; error?: string }> | { success: boolean; error?: string };
  /** Function to get current state */
  getFn: (id: string) => Promise<{ status: string }> | { status: string };
}

/**
 * Generates a full test suite for a state machine.
 * Tests all valid transitions succeed and all invalid transitions are rejected.
 */
export function testStateMachine(config: StateMachineConfig): void {
  describe(`${config.entity} state machine`, () => {
    // For each valid transition: seed entity in "from" state, update to "to" state, assert success
    describe('valid transitions', () => {
      for (const [from, to] of config.validTransitions) {
        it(`should allow ${from} → ${to}`, async () => {
          const id = await config.seedFn(from);
          const result = await config.updateFn(id, to);
          expect(result.success).toBe(true);
          const entity = await config.getFn(id);
          expect(entity.status).toBe(to);
        });
      }
    });

    // For each INVALID transition (all state pairs NOT in validTransitions): assert rejection
    describe('invalid transitions', () => {
      const validSet = new Set(config.validTransitions.map(([f, t]) => `${f}\u2192${t}`));
      for (const from of config.states) {
        for (const to of config.states) {
          if (from === to) continue; // same-state is not a transition
          if (validSet.has(`${from}\u2192${to}`)) continue; // skip valid ones
          it(`should reject ${from} → ${to}`, async () => {
            const id = await config.seedFn(from);
            const result = await config.updateFn(id, to);
            expect(result.success).toBe(false);
            // Verify state unchanged
            const entity = await config.getFn(id);
            expect(entity.status).toBe(from);
          });
        }
      }
    });
  });
}
