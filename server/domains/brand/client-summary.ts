import type { ClientBrandSummary } from '../../../shared/types/brand-generation.js';
import { listDeliverables } from '../../brand-deliverable-read-model.js';
import { renderVoiceDNASummary } from '../../voice-dna-render.js';
import { getWorkspace } from '../../workspaces.js';
import { getCurrentFinalizedVoiceAuthority } from './voice-finalization.js';

/**
 * Build the authenticated client projection of approved brand deliverables
 * and the current finalized voice summary.
 *
 * This is an explicit allow-list boundary. It never spreads source rows and
 * therefore cannot expose intake, draft content, samples, guardrails, review
 * evidence, prompts, provenance, or generation/source references.
 */
export function getClientBrandSummary(workspaceId: string): ClientBrandSummary | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  const approvedSources = listDeliverables(workspaceId)
    .filter(deliverable => deliverable.status === 'approved');
  const approvedDeliverables = approvedSources.map(deliverable => ({
    deliverableType: deliverable.deliverableType,
    content: deliverable.content,
    version: deliverable.version,
  }));

  const voiceAuthority = getCurrentFinalizedVoiceAuthority(workspaceId);
  const voiceSummary = voiceAuthority
    ? renderVoiceDNASummary(voiceAuthority.voiceDNA).trim() || null
    : null;

  const sourceUpdatedAt = [
    ...approvedSources.map(deliverable => deliverable.updatedAt),
    ...(voiceSummary && voiceAuthority ? [voiceAuthority.finalizedAt] : []),
  ];
  const updatedAt = sourceUpdatedAt.length > 0
    ? sourceUpdatedAt.reduce((latest, candidate) => candidate > latest ? candidate : latest)
    : workspace.createdAt;

  return {
    workspaceId,
    approvedDeliverables,
    voiceSummary,
    updatedAt,
  };
}
