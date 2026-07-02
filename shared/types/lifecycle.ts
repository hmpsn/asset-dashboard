/**
 * Shared lifecycle envelope over the existing state-machine transition tables.
 *
 * This is a TYPED WRAPPER, not a parallel authority. The single source of truth
 * for legal transitions remains the `*_TRANSITIONS` tables in
 * `server/state-machines.ts`; this module simply gives every one of those tables
 * a uniform, typed identity (`entity`, `states`, `transitions`) and gathers them
 * into a single registry that census tooling and contract tests can enumerate.
 *
 * Rules:
 *  - Registering a definition NEVER changes a transition table's vocabulary or
 *    edges. `LifecycleDefinition.transitions` MUST reference the exact
 *    `*_TRANSITIONS` object from state-machines.ts (identity-equal), so the
 *    envelope can never drift from the guarded map that `validateTransition`
 *    actually reads.
 *  - Only true lifecycle state machines (an entity whose status column is mutated
 *    through legal transitions) belong in `LIFECYCLE_REGISTRY`. Classification /
 *    derived-projection unions (e.g. quota health, term-coverage grades) are
 *    explicitly out of scope — see `docs/rules/lifecycle-state-machines.md`.
 *  - The registry is assembled on the server side (state-machines.ts is a server
 *    module); this file defines only the shared contract types so callers on
 *    either side of the boundary can reason about lifecycle shape.
 */

/**
 * A single entity's lifecycle: the set of legal states and, for each state, the
 * set of states it may transition to.
 *
 * @typeParam S - the string-literal union of legal states for this entity.
 */
export interface LifecycleDefinition<S extends string> {
  /** Stable snake_case entity key (e.g. `approval_item`, `work_order`). */
  entity: string;
  /** All legal states. Must equal the keys of `transitions`. */
  states: readonly S[];
  /** Adjacency map: `state → legal next states`. Identity-equal to the state-machines.ts table. */
  transitions: Readonly<Record<S, readonly S[]>>;
}

/**
 * The runtime registry of all entity lifecycles.
 *
 * Populated on the server by `server/state-machines.ts`, which pushes one
 * `LifecycleDefinition` per exported `*_TRANSITIONS` table into this array as a
 * side effect of module evaluation. Kept here (in shared types) so the contract
 * test and future census tooling have a single canonical import.
 *
 * Consumers MUST treat this as read-only; the only writer is state-machines.ts.
 */
export const LIFECYCLE_REGISTRY: Array<LifecycleDefinition<string>> = [];

/**
 * Register a lifecycle definition. Called once per transition table from
 * `server/state-machines.ts`. Idempotent guard against a duplicate `entity` key
 * keeps the registry census honest if a module is ever re-evaluated.
 */
export function registerLifecycle<S extends string>(def: LifecycleDefinition<S>): LifecycleDefinition<S> {
  if (!LIFECYCLE_REGISTRY.some((existing) => existing.entity === def.entity)) {
    LIFECYCLE_REGISTRY.push(def as LifecycleDefinition<string>);
  }
  return def;
}
