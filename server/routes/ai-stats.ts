/**
 * AI Usage Statistics API
 * 
 * Provides endpoints for monitoring AI request deduplication performance
 * and token usage across the platform.
 */

import { Router } from 'express';
import { createLogger } from '../logger.js';
import { getTokenUsage } from '../openai-helpers.js';
import { aiDeduplicator } from '../ai-deduplication.js';

const log = createLogger('ai-stats');
const router = Router();

/**
 * Get AI deduplication statistics
 * GET /api/ai-stats/deduplication
 */
router.get('/deduplication', (_req, res) => {
  try {
    const stats = aiDeduplicator.getStats();
    res.json({
      pendingRequests: stats.pendingRequests,
      cacheSize: stats.cacheSize,
      oldestPendingAge: stats.oldestPending,
      oldestCacheAge: stats.oldestCache,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err }, 'Failed to get deduplication stats');
    res.status(500).json({ error: 'Failed to get deduplication stats' });
  }
});

/**
 * Get AI token usage statistics
 * GET /api/ai-stats/usage
 */
router.get('/usage', (req, res) => {
  try {
    const { workspaceId, since, days = 30 } = req.query;
    
    const usage = getTokenUsage(
      workspaceId as string,
      since as string
    );
    
    res.json({
      ...usage,
      workspaceId: workspaceId || 'all',
      period: since ? `since ${since}` : `last ${days} days`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err }, 'Failed to get token usage stats');
    res.status(500).json({ error: 'Failed to get token usage stats' });
  }
});

/**
 * Get AI performance summary
 * GET /api/ai-stats/summary
 */
router.get('/summary', (req, res) => {
  try {
    const { workspaceId } = req.query;
    
    // Get deduplication stats
    const dedupeStats = aiDeduplicator.getStats();
    
    // Get usage stats for last 7 days
    const usage = getTokenUsage(
      workspaceId as string,
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    );
    
    // Calculate efficiency metrics
    const cacheHitRate = dedupeStats.cacheSize > 0 ? 
      (dedupeStats.cacheSize / (dedupeStats.cacheSize + dedupeStats.pendingRequests)) : 0;
    
    const avgTokensPerCall = usage.entries.length > 0 ?
      usage.totalTokens / usage.entries.length : 0;
    
    res.json({
      deduplication: {
        ...dedupeStats,
        cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      },
      usage: {
        totalTokens: usage.totalTokens,
        totalCalls: usage.entries.length,
        estimatedCost: usage.estimatedCost,
        avgTokensPerCall: Math.round(avgTokensPerCall),
      },
      period: 'last 7 days',
      workspaceId: workspaceId || 'all',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err }, 'Failed to get AI summary stats');
    res.status(500).json({ error: 'Failed to get AI summary stats' });
  }
});

export { router as aiStatsRoutes };
