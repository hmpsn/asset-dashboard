import db from '../../../db/index.js';
import { createStmtCache } from '../../../db/stmt-cache.js';
import { getTemplate } from '../../../content-templates.js';
import type {
  AcceptContentTemplateGenerationUpgradeRequest,
  AcceptContentTemplateGenerationUpgradeResult,
} from '../../../../shared/types/matrix-generation.js';
import { verifyContentTemplateGenerationUpgradeProposal } from './template-upgrade.js';
import {
  getTemplateGenerationSourceCensus,
  templateGenerationSourceIsComplete,
} from './source-integrity.js';

export type TemplateGenerationUpgradeErrorCode =
  | 'not_found'
  | 'conflict'
  | 'precondition_failed';

export class TemplateGenerationUpgradeError extends Error {
  readonly code: TemplateGenerationUpgradeErrorCode;

  constructor(code: TemplateGenerationUpgradeErrorCode) {
    super(code);
    this.name = 'TemplateGenerationUpgradeError';
    this.code = code;
  }
}

export type AcceptTemplateGenerationUpgradeActionResult =
  AcceptContentTemplateGenerationUpgradeResult & { replayed: boolean };

interface TemplateUpgradeAuditRow {
  revision: number;
  generation_upgrade_fingerprint: string | null;
  generation_upgrade_idempotency_key: string | null;
  generation_upgrade_source_revision: number | null;
}

const stmts = createStmtCache(() => ({
  selectAudit: db.prepare(`
    SELECT revision,
           generation_upgrade_fingerprint,
           generation_upgrade_idempotency_key,
           generation_upgrade_source_revision
      FROM content_templates
     WHERE id = ? AND workspace_id = ?
  `),
  accept: db.prepare(`
    UPDATE content_templates
       SET sections = @sections,
           generation_contract_version = @generation_contract_version,
           revision = revision + 1,
           generation_upgrade_fingerprint = @proposal_fingerprint,
           generation_upgrade_idempotency_key = @idempotency_key,
           generation_upgrade_source_revision = @expected_revision,
           updated_at = @updated_at
     WHERE id = @template_id
       AND workspace_id = @workspace_id
       AND revision = @expected_revision
       AND (generation_contract_version IS NULL OR generation_contract_version = 0)
       AND generation_upgrade_idempotency_key IS NULL
  `),
}));

function readAudit(
  workspaceId: string,
  templateId: string,
): TemplateUpgradeAuditRow | undefined {
  return stmts().selectAudit.get(templateId, workspaceId) as
    | TemplateUpgradeAuditRow
    | undefined;
}

function acceptedReplayMatches(
  row: TemplateUpgradeAuditRow,
  request: AcceptContentTemplateGenerationUpgradeRequest,
): boolean {
  return request.decision === 'accept'
    && row.generation_upgrade_idempotency_key === request.idempotencyKey
    && row.generation_upgrade_fingerprint === request.proposalFingerprint
    && row.generation_upgrade_source_revision === request.expectedTemplateRevision
    // A later generation-effective template edit increments the revision. In
    // that case returning today's template as the old accepted result would be
    // a false idempotent replay; the caller must resolve the current source.
    && row.revision === request.expectedTemplateRevision + 1;
}

function assertIdempotencyKeyAvailable(
  row: TemplateUpgradeAuditRow,
  request: AcceptContentTemplateGenerationUpgradeRequest,
): void {
  if (
    row.generation_upgrade_idempotency_key === request.idempotencyKey
    && !acceptedReplayMatches(row, request)
  ) {
    throw new TemplateGenerationUpgradeError('conflict');
  }
}

function normalizeRequest(
  request: AcceptContentTemplateGenerationUpgradeRequest,
): AcceptContentTemplateGenerationUpgradeRequest {
  const idempotencyKey = request.idempotencyKey.trim();
  if (
    request.workspaceId.trim().length === 0
    || request.templateId.trim().length === 0
    || !Number.isInteger(request.expectedTemplateRevision)
    || request.expectedTemplateRevision < 0
    || !/^[a-f0-9]{64}$/.test(request.proposalFingerprint)
    || (request.decision !== 'accept' && request.decision !== 'reject')
    || idempotencyKey.length === 0
    || idempotencyKey.length > 200
  ) {
    throw new TemplateGenerationUpgradeError('precondition_failed');
  }
  return { ...request, idempotencyKey };
}

/**
 * Accept or reject one exact deterministic legacy-template upgrade proposal.
 *
 * This service owns the conditional persistence only. HTTP/MCP adapters own
 * their activity and workspace broadcasts, and suppress them on replays.
 */
export function acceptTemplateGenerationUpgrade(
  request: AcceptContentTemplateGenerationUpgradeRequest,
): AcceptTemplateGenerationUpgradeActionResult {
  const normalizedRequest = normalizeRequest(request);

  return db.transaction(() => {
    const auditBefore = readAudit(normalizedRequest.workspaceId, normalizedRequest.templateId);
    if (!auditBefore) throw new TemplateGenerationUpgradeError('not_found');
    assertIdempotencyKeyAvailable(auditBefore, normalizedRequest);

    const template = getTemplate(normalizedRequest.workspaceId, normalizedRequest.templateId);
    if (!template) throw new TemplateGenerationUpgradeError('not_found');
    const sourceCensus = getTemplateGenerationSourceCensus(
      normalizedRequest.workspaceId,
      normalizedRequest.templateId,
    );
    if (!templateGenerationSourceIsComplete(sourceCensus, template)) {
      throw new TemplateGenerationUpgradeError('precondition_failed');
    }

    if (acceptedReplayMatches(auditBefore, normalizedRequest)) {
      return {
        status: 'accepted' as const,
        template,
        proposalFingerprint: normalizedRequest.proposalFingerprint,
        replayed: true,
      };
    }

    const verification = verifyContentTemplateGenerationUpgradeProposal(template, {
      expectedTemplateRevision: normalizedRequest.expectedTemplateRevision,
      proposalFingerprint: normalizedRequest.proposalFingerprint,
    });
    if (
      verification.status === 'stale_revision'
      || verification.status === 'stale_fingerprint'
    ) {
      throw new TemplateGenerationUpgradeError('conflict');
    }
    if (verification.status === 'blocked') {
      throw new TemplateGenerationUpgradeError('precondition_failed');
    }

    if (normalizedRequest.decision === 'reject') {
      return {
        status: 'rejected' as const,
        template,
        proposalFingerprint: normalizedRequest.proposalFingerprint,
        replayed: false,
      };
    }

    const write = stmts().accept.run({
      template_id: normalizedRequest.templateId,
      workspace_id: normalizedRequest.workspaceId,
      expected_revision: normalizedRequest.expectedTemplateRevision,
      sections: JSON.stringify(verification.upgradedSections),
      generation_contract_version: verification.proposal.generationContractVersion,
      proposal_fingerprint: normalizedRequest.proposalFingerprint,
      idempotency_key: normalizedRequest.idempotencyKey,
      updated_at: new Date().toISOString(),
    });
    if (write.changes !== 1) {
      const auditAfter = readAudit(normalizedRequest.workspaceId, normalizedRequest.templateId);
      if (auditAfter && acceptedReplayMatches(auditAfter, normalizedRequest)) {
        const replayedTemplate = getTemplate(normalizedRequest.workspaceId, normalizedRequest.templateId);
        if (!replayedTemplate) throw new TemplateGenerationUpgradeError('not_found');
        return {
          status: 'accepted' as const,
          template: replayedTemplate,
          proposalFingerprint: normalizedRequest.proposalFingerprint,
          replayed: true,
        };
      }
      throw new TemplateGenerationUpgradeError('conflict');
    }

    const acceptedTemplate = getTemplate(normalizedRequest.workspaceId, normalizedRequest.templateId);
    if (!acceptedTemplate) throw new TemplateGenerationUpgradeError('not_found');
    return {
      status: 'accepted' as const,
      template: acceptedTemplate,
      proposalFingerprint: normalizedRequest.proposalFingerprint,
      replayed: false,
    };
  })();
}
