import { describe, expect, it } from 'vitest';
import {
  APPROVAL_ITEM_TRANSITIONS,
  BACKGROUND_JOB_TRANSITIONS,
  BRIEFING_DRAFT_TRANSITIONS,
  CLIENT_ACTION_TRANSITIONS,
  CONTENT_REQUEST_TRANSITIONS,
  CONTENT_SUB_TRANSITIONS,
  POST_STATUS_TRANSITIONS,
  TRACKED_KEYWORD_TRANSITIONS,
  WORK_ORDER_TRANSITIONS,
  COPY_SECTION_TRANSITIONS,
  EXTRACTION_TRANSITIONS,
  SUGGESTED_BRIEF_TRANSITIONS,
  SEO_SUGGESTION_TRANSITIONS,
  PENDING_SCHEMA_TRANSITIONS,
  validateTransition,
} from '../../server/state-machines.js';
import { LIFECYCLE_REGISTRY } from '../../shared/types/lifecycle.js';

type TransitionMap = Record<string, readonly string[]>;

interface TransitionGraphSpec {
  name: string;
  map: TransitionMap;
}

const TRANSITION_GRAPHS: TransitionGraphSpec[] = [
  { name: 'approval_item', map: APPROVAL_ITEM_TRANSITIONS },
  { name: 'content_request', map: CONTENT_REQUEST_TRANSITIONS },
  { name: 'post', map: POST_STATUS_TRANSITIONS },
  { name: 'work_order', map: WORK_ORDER_TRANSITIONS },
  { name: 'content_subscription', map: CONTENT_SUB_TRANSITIONS },
  { name: 'client_action', map: CLIENT_ACTION_TRANSITIONS },
  { name: 'briefing_draft', map: BRIEFING_DRAFT_TRANSITIONS },
  { name: 'background_job', map: BACKGROUND_JOB_TRANSITIONS },
  { name: 'tracked_keyword', map: TRACKED_KEYWORD_TRANSITIONS },
  // R3-PR2: newly folded / newly guarded lifecycles with a terminal state and no
  // self-edges. Cyclic maps without a terminal state (voice_profile,
  // insight_resolution, blueprint, brand_deliverable, client_location, client_signal)
  // are envelope-registered but intentionally excluded from this terminal-requiring
  // pinned list — client_signal is a fully-reversible triage graph (admin undo path),
  // the others are recalibrate/reopen cycles; their idempotent no-ops are handled at
  // the write boundary.
  { name: 'copy_section', map: COPY_SECTION_TRANSITIONS },
  { name: 'discovery_extraction', map: EXTRACTION_TRANSITIONS },
  { name: 'suggested_brief', map: SUGGESTED_BRIEF_TRANSITIONS },
  { name: 'seo_suggestion', map: SEO_SUGGESTION_TRANSITIONS },
  { name: 'pending_schema', map: PENDING_SCHEMA_TRANSITIONS },
];

function assertGraphShape(name: string, graph: TransitionMap): void {
  const states = Object.keys(graph);
  expect(states.length, `${name} should have at least one state`).toBeGreaterThan(0);

  const terminals = states.filter(state => graph[state].length === 0);
  expect(terminals.length, `${name} should have at least one terminal state`).toBeGreaterThan(0);

  for (const [from, targets] of Object.entries(graph)) {
    const uniqueTargets = new Set(targets);
    expect(uniqueTargets.size, `${name}:${from} should not have duplicate targets`).toBe(targets.length);
    expect(targets.includes(from), `${name}:${from} should not self-transition`).toBe(false);

    for (const to of targets) {
      expect(states.includes(to), `${name}:${from} has unknown target '${to}'`).toBe(true);
    }
  }
}

describe('state-machine graph contracts', () => {
  // The lifecycle envelope (R3-PR1) is a typed VIEW over these tables — registering a
  // table must never change its edges. Prove each pinned graph is wrapped by a registry
  // entry whose transition object is IDENTITY-equal to the table (no copy, no drift).
  it('each pinned graph is registered in the lifecycle envelope by object identity', () => {
    const registeredMaps = new Set(LIFECYCLE_REGISTRY.map((def) => def.transitions));
    for (const spec of TRANSITION_GRAPHS) {
      expect(
        registeredMaps.has(spec.map),
        `${spec.name} transition table is not registered by identity in LIFECYCLE_REGISTRY`,
      ).toBe(true);
    }
  });

  for (const spec of TRANSITION_GRAPHS) {
    it(`${spec.name}: transition map remains internally consistent`, () => {
      assertGraphShape(spec.name, spec.map);
    });

    it(`${spec.name}: validateTransition matches the graph for every state pair`, () => {
      const states = Object.keys(spec.map);

      for (const from of states) {
        const allowed = new Set(spec.map[from]);
        for (const to of states) {
          const shouldPass = allowed.has(to);

          if (shouldPass) {
            expect(() => validateTransition(spec.name, spec.map, from, to)).not.toThrow();
          } else {
            expect(() => validateTransition(spec.name, spec.map, from, to)).toThrow();
          }
        }
      }
    });
  }
});
