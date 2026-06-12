// server/routes/debug.ts
// Admin debug endpoint — returns formatted WorkspaceIntelligence prompt for staging verification.
// Only available in non-production environments.

import { Router } from 'express';
import { buildWorkspaceIntelligence, formatForPrompt } from '../workspace-intelligence.js';
import { getWorkspace } from '../workspaces.js';
import { requireWorkspaceAccessFromQuery } from '../auth.js';
import {
  PROMPT_FORMATTABLE_INTELLIGENCE_SLICES,
  isPromptFormattableIntelligenceSlice,
} from '../../shared/types/intelligence.js';
import type { IntelligenceOptions, IntelligenceSlice, PromptFormatOptions } from '../../shared/types/intelligence.js';

// Disabled when DISABLE_DEBUG_ENDPOINTS=true (set this in production, not staging)
const DISABLED = process.env.DISABLE_DEBUG_ENDPOINTS === 'true';

const router = Router();

/**
 * GET /api/debug/prompt
 * Query params:
 *   workspaceId (required) — workspace to assemble intelligence for
 *   slices (optional) — comma-separated slice names, defaults to all
 *   pagePath (optional) — page path for pageProfile slice
 *   verbosity (optional) — 'compact' | 'standard' | 'detailed', defaults to 'detailed'
 *   learningsDomain (optional) — 'content' | 'strategy' | 'technical' | 'all'
 *
 * Returns plain text prompt output for inspection.
 */
router.get('/api/debug/prompt', requireWorkspaceAccessFromQuery(), async (req, res) => {
  if (DISABLED) {
    return res.status(404).json({ error: 'Not found' });
  }

  const {
    workspaceId,
    pagePath,
    verbosity,
    learningsDomain,
    siteId,
    siteBaseUrl,
  } = req.query as Record<string, string | undefined>;

  // Auth: the global admin gate in app.ts (HMAC or any internal JWT) plus the
  // requireWorkspaceAccessFromQuery middleware above (denies JWT users scoped to
  // other workspaces). Workspace existence is validated explicitly below.
  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  // Parse slices param — default to all slices
  const rawSlices = req.query.slices as string | undefined;
  const slices: IntelligenceSlice[] = rawSlices
    ? rawSlices.split(',').map(s => s.trim()).filter(isPromptFormattableIntelligenceSlice)
    : [...PROMPT_FORMATTABLE_INTELLIGENCE_SLICES];

  if (slices.length === 0) {
    return res.status(400).json({ error: 'No prompt-formattable intelligence slices specified' });
  }

  const formatVerbosity = (['compact', 'standard', 'detailed'] as const).find(v => v === verbosity) ?? 'detailed';
  const formatDomain = (['content', 'strategy', 'technical', 'all'] as const).find(d => d === learningsDomain) ?? 'all';

  try {
    const opts: IntelligenceOptions = {
      slices,
      pagePath: pagePath || undefined,
      learningsDomain: formatDomain,
      siteId: siteId || undefined,
      siteBaseUrl: siteBaseUrl || undefined,
    };
    const intel = await buildWorkspaceIntelligence(workspaceId, opts); // bwi-all-ok: debug prompt endpoint intentionally defaults to all prompt-formattable slices
    const formatOpts: PromptFormatOptions = {
      verbosity: formatVerbosity,
      sections: slices,
      learningsDomain: formatDomain,
    };
    const prompt = formatForPrompt(intel, formatOpts);
    res.type('text/plain').send(prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
