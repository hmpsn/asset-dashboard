/**
 * Deliverable adapter registry barrel (Phase 0, dark — empty).
 *
 * Each Phase-1 type PR appends ONE line here: `import './<type>.js';` (append-only,
 * the only shared edit across the parallel type PRs). Importing this module triggers
 * each adapter's module-scope `registerAdapter()` call, populating the registry in
 * `./types.js`. Phase 0 ships zero adapters — the send path is dark until the flags flip.
 *
 * Re-export the registry surface so callers `import { getAdapter } from '.../deliverable-adapters/index.js'`
 * and get a fully-populated registry (the adapter imports above have run first).
 */

// --- Phase-1 adapter registrations go below this line (append-only) ---
// (none in Phase 0)

export {
  registerAdapter,
  getAdapter,
  tryGetAdapter,
  listAdapterTypes,
  type DeliverableAdapter,
  type BuiltDeliverablePayload,
  type SendableResult,
} from './types.js';
