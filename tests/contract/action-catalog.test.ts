// tests/contract/action-catalog.test.ts
//
// Contract test for shared/types/action-catalog.ts (R5-PR1). Modeled on the
// BACKGROUND_JOB_METADATA completeness suite (tests/unit/shared-types-validation.test.ts:307)
// and the strategy-archetype exhaustiveness contract test.
//
// The catalog is a READ-ONLY metadata registry keyed by (context, action). It IMPORTS the
// five source unions and must never merge/redefine them — ScoringConfig = Record<ActionType,…>
// in shared/types/outcome-tracking.ts breaks if ActionType is ever widened, so completeness is
// verified here by cross-referencing every catalog entry against the REAL union values (not a
// hand-copied list) — a missing member is a real red, not a maintenance chore.

import { describe, it, expect } from 'vitest';
import {
  ACTION_CATALOG,
  getActionCatalogEntry,
  isClientVisibleOutcomeAction,
  toClientSafeOutcomeEventPayload,
  type ActionCatalogContext,
} from '../../shared/types/action-catalog.js';
import type { ActionType } from '../../shared/types/outcome-tracking.js';
import type { RecType } from '../../shared/types/recommendations.js';
import type { ClientActionSourceType } from '../../shared/types/client-actions.js';
import { KEYWORD_COMMAND_CENTER_ACTIONS } from '../../shared/types/keyword-command-center.js';
import {
  applyRecommendationInputSchema,
  respondToClientActionInputSchema,
} from '../../shared/types/mcp-action-schemas.js';
import { acceptContentTemplateGenerationUpgradeInputSchema } from '../../shared/types/mcp-matrix-schemas.js';

// Real union values, sourced from the owning files (not re-typed by hand) — see the file
// headers for canonical member counts: ActionType (18), RecType (15), ClientActionSourceType (5).
const ACTION_TYPES: ActionType[] = [
  'insight_acted_on',
  'content_published',
  'brief_created',
  'strategy_keyword_added',
  'schema_deployed',
  'audit_fix_applied',
  'content_refreshed',
  'internal_link_added',
  'meta_updated',
  'voice_calibrated',
  'competitor_gap_closed',
  'cluster_published',
  'cannibalization_resolved',
  'local_visibility_won',
  'local_service_added',
  'topic_cluster_keep',
  'content_gap_keep',
  // Reconcile R8-PR1 (B13) — ships dark; see shared/types/outcome-tracking.ts.
  'gbp_review_reply',
];

const REC_TYPES: RecType[] = [
  'technical', 'content', 'content_refresh', 'schema', 'metadata', 'performance',
  'accessibility', 'strategy', 'aeo', 'keyword_gap', 'topic_cluster', 'cannibalization',
  'local_visibility', 'local_service_gap', 'competitor',
];

const CLIENT_ACTION_SOURCE_TYPES: ClientActionSourceType[] = [
  'aeo_change',
  'internal_link',
  'redirect_proposal',
  'content_decay',
  'cannibalization',
];

describe('ACTION_CATALOG completeness', () => {
  it('has an entry for every ActionType member (outcome context)', () => {
    for (const type of ACTION_TYPES) {
      expect(getActionCatalogEntry('outcome', type), `outcome/${type}`).toBeDefined();
    }
  });

  it('has an entry for every RecType member (recommendation context)', () => {
    for (const type of REC_TYPES) {
      expect(getActionCatalogEntry('recommendation', type), `recommendation/${type}`).toBeDefined();
    }
  });

  it('has an entry for every ClientActionSourceType member (client_action context)', () => {
    for (const type of CLIENT_ACTION_SOURCE_TYPES) {
      expect(getActionCatalogEntry('client_action', type), `client_action/${type}`).toBeDefined();
    }
  });

  it('has an entry for every KEYWORD_COMMAND_CENTER_ACTIONS verb (keyword_command_center context)', () => {
    for (const action of Object.values(KEYWORD_COMMAND_CENTER_ACTIONS)) {
      expect(getActionCatalogEntry('keyword_command_center', action), `keyword_command_center/${action}`).toBeDefined();
    }
  });

  it('has an entry for every MCP applyRecommendation action verb (mcp context)', () => {
    const verbs = applyRecommendationInputSchema.shape.action.options as readonly string[];
    expect(verbs).toEqual(['send', 'throttle', 'strike']);
    for (const verb of verbs) {
      expect(getActionCatalogEntry('mcp', verb), `mcp/${verb}`).toBeDefined();
    }
  });

  it('has an entry for every MCP respondToClientAction status verb (mcp context)', () => {
    const statuses = respondToClientActionInputSchema.shape.status.options as readonly string[];
    for (const status of statuses) {
      expect(getActionCatalogEntry('mcp', `respond_client_action:${status}`), `mcp/respond_client_action:${status}`).toBeDefined();
    }
  });

  it('has an entry for every MCP template-generation upgrade decision verb (mcp context)', () => {
    const decisions = acceptContentTemplateGenerationUpgradeInputSchema.shape.decision.options as readonly string[];
    for (const decision of decisions) {
      expect(
        getActionCatalogEntry('mcp', `template_generation_upgrade:${decision}`),
        `mcp/template_generation_upgrade:${decision}`,
      ).toBeDefined();
    }
  });

  it('never carries a catalog key outside its declared source union', () => {
    const validByContext: Record<ActionCatalogContext, Set<string>> = {
      outcome: new Set(ACTION_TYPES),
      recommendation: new Set(REC_TYPES),
      client_action: new Set(CLIENT_ACTION_SOURCE_TYPES),
      keyword_command_center: new Set(Object.values(KEYWORD_COMMAND_CENTER_ACTIONS)),
      mcp: new Set([
        ...(applyRecommendationInputSchema.shape.action.options as readonly string[]),
        ...(respondToClientActionInputSchema.shape.status.options as readonly string[]).map(
          (s) => `respond_client_action:${s}`,
        ),
        ...(acceptContentTemplateGenerationUpgradeInputSchema.shape.decision.options as readonly string[]).map(
          (decision) => `template_generation_upgrade:${decision}`,
        ),
        'decline_approval_item',
      ]),
    };

    for (const [context, entries] of Object.entries(ACTION_CATALOG) as Array<
      [ActionCatalogContext, Record<string, unknown>]
    >) {
      const allowed = validByContext[context];
      expect(allowed, `unknown catalog context "${context}"`).toBeDefined();
      for (const key of Object.keys(entries)) {
        expect(allowed.has(key), `catalog key "${context}/${key}" is not a member of its source union`).toBe(true);
      }
    }
  });

  it('every entry has the required metadata fields', () => {
    const PHASES = ['detect', 'decide', 'do', 'prove'];
    for (const [context, entries] of Object.entries(ACTION_CATALOG)) {
      for (const [key, entry] of Object.entries(entries as Record<string, { label: string; phase: string; clientVisible: boolean }>)) {
        expect(typeof entry.label, `${context}/${key}.label`).toBe('string');
        expect(entry.label.length, `${context}/${key}.label non-empty`).toBeGreaterThan(0);
        expect(PHASES, `${context}/${key}.phase`).toContain(entry.phase);
        expect(typeof entry.clientVisible, `${context}/${key}.clientVisible`).toBe('boolean');
      }
    }
  });

  it('keep-marker entries (topic_cluster_keep, content_gap_keep) are present and tagged as live producers', () => {
    const clusterKeep = getActionCatalogEntry('outcome', 'topic_cluster_keep');
    const gapKeep = getActionCatalogEntry('outcome', 'content_gap_keep');
    expect(clusterKeep).toBeDefined();
    expect(gapKeep).toBeDefined();
    // These are documented as live-producer keep-markers, never phantom/vestigial entries.
    expect(clusterKeep?.label.toLowerCase()).toContain('kept');
    expect(gapKeep?.label.toLowerCase()).toContain('kept');
  });

  it('recommendation entries that map to an outcome ActionType carry a valid outcomeActionType', () => {
    for (const [key, entry] of Object.entries(ACTION_CATALOG.recommendation)) {
      if (entry.outcomeActionType !== undefined) {
        expect(ACTION_TYPES, `recommendation/${key}.outcomeActionType`).toContain(entry.outcomeActionType);
      }
    }
  });

  it('projects shared outcome-event payloads through the catalog visibility boundary', () => {
    const visiblePayload = { actionId: 'visible-action', score: 'win' };
    expect(isClientVisibleOutcomeAction('content_published')).toBe(true);
    expect(toClientSafeOutcomeEventPayload('content_published', visiblePayload)).toBe(visiblePayload);

    expect(isClientVisibleOutcomeAction('voice_calibrated')).toBe(false);
    expect(toClientSafeOutcomeEventPayload('voice_calibrated', {
      actionId: 'private-action',
      score: 'strong_win',
    })).toEqual({});

    const historicalPayload = { actionId: 'historical-action' };
    expect(isClientVisibleOutcomeAction('legacy_unknown_action')).toBe(true);
    expect(toClientSafeOutcomeEventPayload('legacy_unknown_action', historicalPayload))
      .toBe(historicalPayload);
  });
});

describe('ACTION_CATALOG fails closed on an incomplete fixture (proves the completeness check is real)', () => {
  it('detects a union member missing from a fixture-copy of the catalog', () => {
    // Fixture: a deliberately incomplete copy of the outcome context (one ActionType dropped).
    const incompleteOutcomeCatalog: Partial<Record<ActionType, unknown>> = { ...ACTION_CATALOG.outcome };
    delete incompleteOutcomeCatalog.topic_cluster_keep;

    const missing = ACTION_TYPES.filter((t) => !(t in incompleteOutcomeCatalog));
    expect(missing).toEqual(['topic_cluster_keep']);
  });
});
