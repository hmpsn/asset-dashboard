import type { FinalizeBrandVoiceResult } from '../../../shared/types/voice-finalization.js';
import { toClientSafeOutcomeEventPayload } from '../../../shared/types/action-catalog.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { createLogger } from '../../logger.js';
import { invalidateMonthlyDigestCache } from '../../monthly-digest-cache.js';
import { recordAction } from '../../outcome-tracking.js';
import { WS_EVENTS } from '../../ws-events.js';

const log = createLogger('voice-finalization-effects');

export interface VoiceFinalizationEffectDependencies {
  addActivity: typeof addActivity;
  broadcastToWorkspace: typeof broadcastToWorkspace;
  invalidateIntelligenceCache: typeof invalidateIntelligenceCache;
  invalidateMonthlyDigestCache: typeof invalidateMonthlyDigestCache;
  recordAction: typeof recordAction;
}

const defaultDependencies: VoiceFinalizationEffectDependencies = {
  addActivity,
  broadcastToWorkspace,
  invalidateIntelligenceCache,
  invalidateMonthlyDigestCache,
  recordAction,
};

function runPostCommitEffect(
  workspaceId: string,
  effect: string,
  run: () => void,
): void {
  try {
    run();
  } catch (error) {
    log.warn(
      { err: error, workspaceId, effect },
      'voice finalization post-commit effect failed',
    );
  }
}

/**
 * Apply the shared effects for one newly committed immutable voice version.
 * Both direct HTTP and MCP execution call this function so replay, activity,
 * outcome, event, and cache semantics cannot drift between transports.
 */
export function applyVoiceFinalizationPostCommitEffects(
  workspaceId: string,
  result: FinalizeBrandVoiceResult,
  dependencies: VoiceFinalizationEffectDependencies = defaultDependencies,
): void {
  if (!result.created) return;

  const snapshot = result.snapshot;
  const metadata = {
    voiceProfileId: snapshot.voiceProfileId,
    finalizationId: snapshot.id,
    profileRevision: result.profileRevision,
    voiceVersion: snapshot.voiceVersion,
    fingerprint: snapshot.fingerprint,
  };

  runPostCommitEffect(workspaceId, 'activity', () => {
    dependencies.addActivity(
      workspaceId,
      'voice_calibrated',
      'Finalized brand voice',
      `Finalized voice profile revision ${result.profileRevision}.`,
      metadata,
      {
        id: snapshot.finalizedBy.actorId,
        name: snapshot.finalizedBy.actorLabel,
      },
    );
  });

  runPostCommitEffect(workspaceId, 'outcome', () => {
    const action = dependencies.recordAction({ // recordAction-ok: workspaceId belongs to the successfully committed finalization
      workspaceId,
      actionType: 'voice_calibrated',
      sourceType: 'brand_voice',
      // `brand_voice` is a workspace self-reference in the outcome source
      // integrity contract. Separate tracked-action rows represent each durable
      // finalization; context preserves the exact immutable version provenance.
      sourceId: workspaceId,
      pageUrl: null,
      targetKeyword: null,
      baselineSnapshot: { captured_at: snapshot.finalizedAt },
      attribution: 'platform_executed',
      context: {
        notes: `voiceFinalizationId=${snapshot.id};voiceVersion=${snapshot.voiceVersion};profileRevision=${result.profileRevision}`,
      },
      // Workspace self-reference: there is no ephemeral titled producer to
      // snapshot, so the canonical generic action label remains truthful.
    });
    dependencies.broadcastToWorkspace(
      workspaceId,
      WS_EVENTS.OUTCOME_ACTION_RECORDED,
      toClientSafeOutcomeEventPayload('voice_calibrated', { actionId: action.id }),
    );
  });

  runPostCommitEffect(workspaceId, 'workspace-broadcast', () => {
    // Shared subscribers receive only resource identity and readiness state.
    // Operator authorization, MCP execution identity, and bearer material stay
    // behind their admin/durable provenance boundaries.
    dependencies.broadcastToWorkspace(
      workspaceId,
      WS_EVENTS.VOICE_PROFILE_UPDATED,
      {
        workspaceId,
        voiceProfileId: snapshot.voiceProfileId,
        finalizationId: snapshot.id,
        profileRevision: result.profileRevision,
        voiceVersion: snapshot.voiceVersion,
        status: 'calibrated',
      },
    );
  });

  runPostCommitEffect(workspaceId, 'intelligence-cache', () => {
    dependencies.invalidateIntelligenceCache(workspaceId);
  });
  runPostCommitEffect(workspaceId, 'monthly-digest-cache', () => {
    dependencies.invalidateMonthlyDigestCache(workspaceId);
  });
}
