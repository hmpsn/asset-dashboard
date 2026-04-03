// server/routes/debug.ts
// Admin debug endpoint — returns formatted WorkspaceIntelligence prompt for staging verification.
// Only available in non-production environments.

import { Router } from 'express';
import { buildWorkspaceIntelligence, formatForPrompt } from '../workspace-intelligence.js';
import { getWorkspace } from '../workspaces.js';
import type { IntelligenceSlice, PromptFormatOptions } from '../../shared/types/intelligence.js';

const VALID_SLICES: Set<string> = new Set([
  'seoContext', 'insights', 'learnings', 'pageProfile',
  'contentPipeline', 'siteHealth', 'clientSignals', 'operational',
]);

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
router.get('/api/debug/prompt', async (req, res) => {
  if (DISABLED) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { workspaceId, pagePath, verbosity, learningsDomain } = req.query as Record<string, string | undefined>;

  // Auth: all /api/ routes are protected by the global APP_PASSWORD gate in app.ts.
  // requireWorkspaceAccess() cannot be used here because workspaceId is a query param, not a route param.
  // Workspace existence is validated explicitly below.
  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  // Parse slices param — default to all slices
  const rawSlices = req.query.slices as string | undefined;
  const slices: IntelligenceSlice[] = rawSlices
    ? rawSlices.split(',').map(s => s.trim()).filter(s => VALID_SLICES.has(s)) as IntelligenceSlice[]
    : [...VALID_SLICES] as IntelligenceSlice[];

  if (slices.length === 0) {
    return res.status(400).json({ error: 'No valid slices specified' });
  }

  const formatVerbosity = (['compact', 'standard', 'detailed'] as const).find(v => v === verbosity) ?? 'detailed';
  const formatDomain = (['content', 'strategy', 'technical', 'all'] as const).find(d => d === learningsDomain) ?? 'all';

  try {
    const intel = await buildWorkspaceIntelligence(workspaceId, { slices, pagePath });
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
