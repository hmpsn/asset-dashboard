/**
 * workspace-authority — per-workspace referring-domains authority store (PR5 · Spine C).
 *
 * Persists the REAL backlink-derived authority signal (referring domains →
 * `backlinkProfileToAuthorityStrength`) for the Opportunity Value scoring path.
 * This REPLACES the organic-keyword-count `domainStrength` proxy on the OV path
 * ONLY — the legacy `resolveDomainStrength` / `adjustKdImpactScore` path is left
 * byte-identical (it still feeds the production impactScore). All of this is dark
 * while the `opportunity-value-scorer` flag is OFF (OV value is shadow-only).
 *
 * Lockstep (CLAUDE.md DB column + mapper): migration 108 + row interface +
 * rowToWorkspaceAuthority + getOrCreate + upsert + Zod schema, all here.
 */
import { z } from 'zod';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { backlinkProfileToAuthorityStrength } from './authority-context.js';
import type { BacklinkProfile } from '../shared/types/intelligence.js';

export interface WorkspaceAuthority {
  workspaceId: string;
  referringDomains: number;
  authorityStrength: number;
  capturedAt: string;
}

interface WorkspaceAuthorityRow {
  workspace_id: string;
  referring_domains: number;
  authority_strength: number;
  captured_at: string;
}

/** Zod schema mirroring the persisted row shape (validation parity per CLAUDE.md). */
export const workspaceAuthoritySchema = z.object({
  workspaceId: z.string(),
  referringDomains: z.number(),
  authorityStrength: z.number(),
  capturedAt: z.string(),
});

function rowToWorkspaceAuthority(r: WorkspaceAuthorityRow): WorkspaceAuthority {
  return {
    workspaceId: r.workspace_id,
    referringDomains: r.referring_domains,
    authorityStrength: r.authority_strength,
    capturedAt: r.captured_at,
  };
}

const stmts = createStmtCache(() => ({
  get: db.prepare<[workspaceId: string]>('SELECT * FROM workspace_authority WHERE workspace_id = ?'),
  upsert: db.prepare(`
    INSERT INTO workspace_authority (workspace_id, referring_domains, authority_strength, captured_at)
    VALUES (@workspace_id, @referring_domains, @authority_strength, @captured_at)
    ON CONFLICT(workspace_id) DO UPDATE SET
      referring_domains = excluded.referring_domains,
      authority_strength = excluded.authority_strength,
      captured_at = excluded.captured_at
  `),
}));

/**
 * Persist (insert-or-update) the referring-domains authority for a workspace.
 * `authority_strength` is always derived from `referringDomains` so the stored
 * bucket and the raw signal can never drift apart.
 */
export function upsertWorkspaceAuthority(workspaceId: string, referringDomains: number): WorkspaceAuthority {
  const rd = Number.isFinite(referringDomains) && referringDomains > 0 ? Math.round(referringDomains) : 0;
  const authorityStrength = backlinkProfileToAuthorityStrength({ totalBacklinks: 0, referringDomains: rd });
  const record: WorkspaceAuthority = {
    workspaceId,
    referringDomains: rd,
    authorityStrength,
    capturedAt: new Date().toISOString(),
  };
  stmts().upsert.run({
    workspace_id: record.workspaceId,
    referring_domains: record.referringDomains,
    authority_strength: record.authorityStrength,
    captured_at: record.capturedAt,
  });
  return record;
}

/**
 * Always returns a WorkspaceAuthority (never null). Reads the persisted row when
 * present; otherwise materializes a default (0 referring domains → strength 0)
 * row and returns it. Non-nullable per the pr-check getOrCreate rule — callers
 * never need a null guard.
 */
export function getOrCreateWorkspaceAuthority(workspaceId: string): WorkspaceAuthority {
  const existing = stmts().get.get(workspaceId) as WorkspaceAuthorityRow | undefined;
  if (existing) return rowToWorkspaceAuthority(existing);
  // Default day-one row: authority unknown (0). Persist so callers see a stable row.
  return upsertWorkspaceAuthority(workspaceId, 0);
}

/**
 * OV-path authority resolver (SEPARATE from the legacy `resolveDomainStrength`).
 * Maps the workspace's ALREADY-RESOLVED backlink profile (referring domains) to the
 * 0/20/50/80 authority-strength bucket via `backlinkProfileToAuthorityStrength`,
 * persisting the result for later reads. Returns the authority strength (0 = unknown).
 *
 * This is the REAL signal — referring domains, not the organic-keyword-count proxy.
 * It feeds OpportunityInput.authorityStrength on the OV path ONLY.
 *
 * DEPENDENCY-INJECTED backlink profile (not a fresh API call): the expensive
 * `getBacklinksOverview` fetch already happens ONCE per rec-gen cycle on the
 * cached/rate-limited intelligence SEO-context path (`assembleSeoContext` with
 * `enrichWithBacklinks`). generateRecommendations passes that profile in here, so
 * we never duplicate the external call (pr-check "getBacklinksOverview called
 * outside workspace intelligence SEO context"). When the profile is absent
 * (no data / unconfigured provider), we degrade to the last-persisted value
 * (or the non-nullable default 0) — never throwing, never blocking generation.
 */
export function resolveOvAuthorityStrength(
  workspaceId: string,
  backlinkProfile: BacklinkProfile | null | undefined,
): number {
  if (!backlinkProfile || typeof backlinkProfile.referringDomains !== 'number') {
    return getOrCreateWorkspaceAuthority(workspaceId).authorityStrength;
  }
  return upsertWorkspaceAuthority(workspaceId, backlinkProfile.referringDomains).authorityStrength;
}
