import { describe, expect, it } from 'vitest';
import * as stateMachines from '../../server/state-machines.js';
import { LIFECYCLE_REGISTRY, type LifecycleDefinition } from '../../shared/types/lifecycle.js';

/**
 * R3-PR1 lifecycle envelope contract (Task B2).
 *
 * The envelope is a typed wrapper over the EXISTING *_TRANSITIONS tables in
 * server/state-machines.ts — zero behavior change. These assertions prove:
 *   1. every *_TRANSITIONS export in state-machines.ts is registered in LIFECYCLE_REGISTRY
 *      (no transition table can silently escape the shared envelope);
 *   2. every registered definition is internally consistent — its declared states
 *      match the transition-map keys and every transition target is a declared state.
 */

type TransitionMap = Record<string, readonly string[]>;

/** Every `export const *_TRANSITIONS` in state-machines.ts, discovered dynamically. */
const EXPORTED_TRANSITION_TABLES: Record<string, TransitionMap> = Object.fromEntries(
  Object.entries(stateMachines).filter(([name]) => name.endsWith('_TRANSITIONS')),
) as Record<string, TransitionMap>;

/** Fast lookup from a transition-map object identity → its registry definition. */
const REGISTRY_BY_MAP = new Map<TransitionMap, LifecycleDefinition<string>>(
  LIFECYCLE_REGISTRY.map((def) => [def.transitions as TransitionMap, def]),
);

/**
 * Two-axis exception (R4 hard boundary): the recommendation lifecycle is modeled as
 * TWO registered definitions — an operator/internal axis (`recommendation`) and a
 * client-response axis (`client_recommendation`). The `curated → sent` edge on the
 * operator axis deliberately hands off to the client axis, where `sent` lives. So
 * the operator map is NOT internally closed on its own; its targets are ⊆ the UNION
 * of both axes' states. Do NOT "fix" this by editing the maps (owner decision: keep
 * the two-axis model). Entities listed here are closed over the union of the whole
 * group instead of over their own states alone.
 */
const TWO_AXIS_GROUPS: readonly (readonly string[])[] = [['recommendation', 'client_recommendation']];

const GROUP_FOR_ENTITY = new Map<string, Set<string>>();
for (const group of TWO_AXIS_GROUPS) {
  const unionStates = new Set<string>();
  for (const entity of group) {
    const def = LIFECYCLE_REGISTRY.find((d) => d.entity === entity);
    if (def) for (const s of def.states) unionStates.add(s);
  }
  for (const entity of group) GROUP_FOR_ENTITY.set(entity, unionStates);
}

describe('lifecycle envelope contract', () => {
  it('discovers at least the 16 known transition tables in state-machines.ts', () => {
    expect(Object.keys(EXPORTED_TRANSITION_TABLES).length).toBeGreaterThanOrEqual(16);
  });

  it('every *_TRANSITIONS export in state-machines.ts is registered in LIFECYCLE_REGISTRY', () => {
    const unregistered: string[] = [];
    for (const [exportName, map] of Object.entries(EXPORTED_TRANSITION_TABLES)) {
      if (!REGISTRY_BY_MAP.has(map)) unregistered.push(exportName);
    }
    expect(
      unregistered,
      `Unregistered transition tables (add to LIFECYCLE_REGISTRY): ${unregistered.join(', ')}`,
    ).toEqual([]);
  });

  it('every registered definition wraps a real state-machines.ts transition table', () => {
    const knownMaps = new Set<TransitionMap>(Object.values(EXPORTED_TRANSITION_TABLES));
    for (const def of LIFECYCLE_REGISTRY) {
      expect(
        knownMaps.has(def.transitions as TransitionMap),
        `${def.entity} registers a transition map that is not an exported *_TRANSITIONS table`,
      ).toBe(true);
    }
  });

  it('registry entity names are unique', () => {
    const names = LIFECYCLE_REGISTRY.map((d) => d.entity);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const _def of LIFECYCLE_REGISTRY) {
    const def = _def as LifecycleDefinition<string>;
    describe(`${def.entity}`, () => {
      it('declared states exactly match the transition-map keys', () => {
        expect(new Set(def.states)).toEqual(new Set(Object.keys(def.transitions)));
      });

      it('every transition target is a declared state (targets ⊆ states)', () => {
        // Two-axis lifecycles (recommendation) are closed over the union of the group.
        const closureStates = GROUP_FOR_ENTITY.get(def.entity) ?? new Set<string>(def.states);
        for (const [from, targets] of Object.entries(def.transitions)) {
          for (const to of targets) {
            expect(
              closureStates.has(to),
              `${def.entity}: transition ${from} → ${to} targets an undeclared state`,
            ).toBe(true);
          }
        }
      });
    });
  }
});
