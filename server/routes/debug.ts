// server/routes/debug.ts
// Admin debug endpoint — returns formatted WorkspaceIntelligence prompt for staging verification.
// Only available in non-production environments.

import { Router } from 'express';
import { buildWorkspaceIntelligence, formatForPrompt } from '../workspace-intelligence.js';
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

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

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
