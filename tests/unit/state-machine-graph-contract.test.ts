import { describe, expect, it } from 'vitest';
import {
  APPROVAL_ITEM_TRANSITIONS,
  BACKGROUND_JOB_TRANSITIONS,
  BRIEFING_DRAFT_TRANSITIONS,
  CLIENT_ACTION_TRANSITIONS,
  CONTENT_REQUEST_TRANSITIONS,
  CONTENT_SUB_TRANSITIONS,
  POST_STATUS_TRANSITIONS,
  WORK_ORDER_TRANSITIONS,
  validateTransition,
} from '../../server/state-machines.js';

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
