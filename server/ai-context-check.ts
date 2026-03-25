/**
 * AI Context Completeness Checker — evaluates how much context
 * is available for AI-powered features in a given workspace.
 * Used to guide admins through onboarding and surface gaps before generation.
 */

import fs from 'fs';
import path from 'path';
import { getWorkspace } from './workspaces.js';
import { countPageKeywords } from './page-keywords.js';
import { getUploadRoot } from './data-dir.js';
import { isSemrushConfigured } from './semrush.js';

export interface ContextSource {
  key: string;
  label: string;
  status: 'connected' | 'missing' | 'partial';
  detail: string;
  /** Which features benefit from this source */
  impacts: string[];
  /** Where to fix it (settings section or action) */
  fixAction?: string;
}

export interface ContextCompleteness {
  workspaceId: string;
  score: number;          // 0-100
  connected: number;
  total: number;
  sources: ContextSource[];
}

/**
 * Check all AI context sources for a workspace.
 */
export function checkAIContext(workspaceId: string): ContextCompleteness {
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    return { workspaceId, score: 0, connected: 0, total: 0, sources: [] };
  }

  const uploadRoot = getUploadRoot();
  const sources: ContextSource[] = [];

  // 1. Webflow site
  sources.push({
    key: 'webflow',
    label: 'Webflow Site',
    status: ws.webflowSiteId ? 'connected' : 'missing',
    detail: ws.webflowSiteId
      ? `Connected: ${ws.webflowSiteName || ws.webflowSiteId}`
      : 'No Webflow site linked',
    impacts: ['strategy', 'audit', 'schema', 'internal-links', 'briefs'],
    fixAction: 'workspace-settings',
  });

  // 2. Google Search Console
  sources.push({
    key: 'gsc',
    label: 'Google Search Console',
    status: ws.gscPropertyUrl ? 'connected' : 'missing',
    detail: ws.gscPropertyUrl
      ? `Connected: ${ws.gscPropertyUrl}`
      : 'Not connected — strategy and briefs lack real search data',
    impacts: ['strategy', 'briefs', 'chat', 'reports'],
    fixAction: 'google-auth',
  });

  // 3. Google Analytics 4
  sources.push({
    key: 'ga4',
    label: 'Google Analytics 4',
    status: ws.ga4PropertyId ? 'connected' : 'missing',
    detail: ws.ga4PropertyId
      ? `Connected: Property ${ws.ga4PropertyId}`
      : 'Not connected — strategy misses conversion data',
    impacts: ['strategy', 'briefs', 'chat', 'reports'],
    fixAction: 'google-auth',
  });

  // 4. Knowledge Base
  const hasInlineKB = !!ws.knowledgeBase?.trim();
  const kbDocsDir = path.join(uploadRoot, ws.folder || ws.id, 'knowledge-docs');
  let kbFileCount = 0;
  try {
    if (fs.existsSync(kbDocsDir)) {
      kbFileCount = fs.readdirSync(kbDocsDir).filter(f => /\.(txt|md)$/i.test(f)).length;
    }
  } catch { /* ignore */ }
  const hasKB = hasInlineKB || kbFileCount > 0;
  sources.push({
    key: 'knowledge-base',
    label: 'Knowledge Base',
    status: hasKB ? 'connected' : 'missing',
    detail: hasKB
      ? `${hasInlineKB ? 'Inline content' : ''}${hasInlineKB && kbFileCount > 0 ? ' + ' : ''}${kbFileCount > 0 ? `${kbFileCount} doc${kbFileCount > 1 ? 's' : ''}` : ''}`
      : 'Empty — AI lacks business context (services, expertise, differentiators)',
    impacts: ['strategy', 'briefs', 'posts', 'chat', 'internal-links'],
    fixAction: 'workspace-settings',
  });

  // 5. Brand Voice
  const hasInlineVoice = !!ws.brandVoice?.trim();
  const brandDocsDir = path.join(uploadRoot, ws.folder || ws.id, 'brand-docs');
  let brandFileCount = 0;
  try {
    if (fs.existsSync(brandDocsDir)) {
      brandFileCount = fs.readdirSync(brandDocsDir).filter(f => /\.(txt|md)$/i.test(f)).length;
    }
  } catch { /* ignore */ }
  const hasVoice = hasInlineVoice || brandFileCount > 0;
  sources.push({
    key: 'brand-voice',
    label: 'Brand Voice',
    status: hasVoice ? 'connected' : 'missing',
    detail: hasVoice
      ? `${hasInlineVoice ? 'Voice guidelines set' : ''}${hasInlineVoice && brandFileCount > 0 ? ' + ' : ''}${brandFileCount > 0 ? `${brandFileCount} doc${brandFileCount > 1 ? 's' : ''}` : ''}`
      : 'Not set — AI uses generic tone instead of client\'s voice',
    impacts: ['briefs', 'posts', 'chat', 'internal-links'],
    fixAction: 'workspace-settings',
  });

  // 6. Audience Personas
  const personaCount = ws.personas?.length || 0;
  sources.push({
    key: 'personas',
    label: 'Audience Personas',
    status: personaCount > 0 ? 'connected' : 'missing',
    detail: personaCount > 0
      ? `${personaCount} persona${personaCount > 1 ? 's' : ''} defined`
      : 'None defined — briefs and posts don\'t target specific audiences',
    impacts: ['briefs', 'posts'],
    fixAction: 'workspace-settings',
  });

  // 7. Keyword Strategy
  const pageCount = countPageKeywords(ws.id);
  const hasStrategy = pageCount > 0;
  sources.push({
    key: 'keyword-strategy',
    label: 'Keyword Strategy',
    status: hasStrategy ? 'connected' : 'missing',
    detail: hasStrategy
      ? `${pageCount} pages mapped with keywords`
      : 'Not generated — briefs lack anti-cannibalization and keyword targets',
    impacts: ['briefs', 'posts', 'chat', 'internal-links'],
    fixAction: 'seo-strategy',
  });

  // 8. SEMRush
  const hasSemrush = isSemrushConfigured();
  sources.push({
    key: 'semrush',
    label: 'SEMRush',
    status: hasSemrush ? 'connected' : 'missing',
    detail: hasSemrush
      ? 'API key configured'
      : 'Not configured — briefs use estimated metrics instead of real data',
    impacts: ['strategy', 'briefs'],
    fixAction: 'settings',
  });

  // Calculate score
  const connected = sources.filter(s => s.status === 'connected').length;
  const total = sources.length;
  const score = Math.round((connected / total) * 100);

  return { workspaceId, score, connected, total, sources };
}
