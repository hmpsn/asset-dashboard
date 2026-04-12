import fs from 'fs';
import path from 'path';
import { getWorkspace, type KeywordStrategy } from './workspaces';
import { getPageKeyword, listPageKeywords } from './page-keywords.js';
import { getUploadRoot } from './data-dir.js';
import { isFeatureEnabled } from './feature-flags.js';
import { getWorkspaceLearnings, formatLearningsForPrompt } from './workspace-learnings.js';
import { createLogger } from './logger.js';
import { listBrandscripts } from './brandscript.js';
import { getVoiceProfile } from './voice-calibration.js';
import { renderVoiceDNAForPrompt, renderVoiceDNASummary } from './voice-dna-render.js';
import { listDeliverables } from './brand-identity.js';
import type { ContextEmphasis, VoiceProfile, VoiceSample } from '../shared/types/brand-engine.js';

const log = createLogger('seo-context');

/**
 * Shared SEO context builder for all AI-powered endpoints.
 * Ensures every AI prompt gets consistent strategy + business context.
 */

/**
 * Graceful wrapper around brand-engine table reads (voice_profiles,
 * brandscripts, brand_identity_deliverables). In production these tables
 * always exist because migrations run at startup, but test environments may
 * skip migrations entirely and a missing table throws from `db.prepare()`
 * inside the stmt-cache initializer — crashing the entire `buildSeoContext`
 * call tree. Mirrors the pattern used in `server/prompt-assembly.ts` where
 * the same concern led to an explicit try/catch around `getVoiceProfile`.
 *
 * The `context` argument is only used for the warn-log so we can distinguish
 * which call site degraded on the dashboard. The fallback value is what the
 * caller would have received from an empty-state read (null / empty array /
 * empty string).
 *
 * **Narrow catch.** We only swallow errors that look like SQLite "no such
 * table / no such column" schema-missing errors — that's the specific
 * test-env scenario this wrapper exists for. Any other error (programming
 * bug in `rowToProfile`, a renamed export, a TypeError from property access,
 * a SyntaxError from JSON parsing that `parseJsonFallback` somehow missed)
 * gets re-thrown so it surfaces loudly in CI and Sentry rather than
 * silently falling through to the legacy brand-voice path. A programming
 * error that only manifests as "brand engine features quietly stopped
 * working in production" is the exact silent-failure class this codebase
 * is trying to eliminate.
 */
const MISSING_SCHEMA_ERROR_RE = /no such (table|column)/i;

function safeBrandEngineRead<T>(context: string, workspaceId: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!MISSING_SCHEMA_ERROR_RE.test(message)) {
      // Unexpected error — not a schema-missing test-env case. Re-throw so
      // the programming bug surfaces instead of silently degrading.
      throw err;
    }
    log.warn({ context, workspaceId, error: message }, 'brand-engine read failed — graceful degradation to legacy path');
    return fallback;
  }
}

/**
 * Resolve the effective brand voice block — the single authority decision
 * for which voice source wins: the modern voice profile, or the legacy
 * `workspace.brandVoice` + brand-docs block.
 *
 * A voice profile is "authoritative" (replaces the legacy brandVoiceBlock)
 * only when either:
 *   (a) `status === 'calibrated'` — `buildSystemPrompt` Layer 2 injects voice
 *       DNA + guardrails into the SYSTEM prompt, and we must not also emit
 *       the legacy block in the USER prompt (two contradictory voice sources
 *       in front of the model), OR
 *   (b) the profile has explicit DNA or guardrails saved AND the rendered
 *       `voiceProfileBlock` is non-empty — the admin has made a deliberate
 *       configuration commitment while still in draft.
 *
 * Samples ALONE do NOT trigger the override. A draft profile with only voice
 * samples is a "preparing to calibrate" state (the admin uploaded source
 * material but hasn't saved any DNA or guardrails yet) — we must NOT silently
 * drop the legacy brandVoice + brand-docs they previously configured. The
 * legacy block stays in place until the admin explicitly commits to the new
 * profile by saving DNA, saving guardrails, or running calibration through
 * to `calibrated`.
 *
 * A fresh draft profile auto-created on `GET /api/voice/:id` has neither DNA
 * nor guardrails nor samples, so it correctly falls through to the legacy
 * block as before.
 *
 * Factored out so the two branches of `buildSeoContext` (strategy / no
 * strategy) and the shadow-mode parity check can never drift. Previously
 * each site hand-rolled the `hasExplicitConfig` + `voiceProfileActive`
 * check, and shadow-mode's copy fell out of sync — missing the
 * `hasExplicitConfig` gate — which caused the parity check to incorrectly
 * skip the raw brand voice comparison for draft profiles with samples but
 * no explicit config.
 *
 * Returns `true` when the voice profile is the authoritative source.
 * (PR #168 scaled-review finding, DRY refactor.)
 */
function isVoiceProfileAuthoritative(profile: VoiceProfile | null, voiceProfileBlock: string): boolean {
  if (profile === null) return false;
  if (profile.status === 'calibrated') return true;
  // Use `!= null` (loose equality) rather than `!== undefined` — it's robust
  // to both `null` and `undefined`. The `VoiceProfile` type currently declares
  // `voiceDNA?: VoiceDNA` so only `undefined` is reachable today, but
  // `rowToProfile` in voice-calibration.ts maps corrupted-JSON DB columns
  // through `parseJsonFallback(...) ?? undefined`. If a future refactor widens
  // the type to `VoiceDNA | null` or drops the `?? undefined` coercion, a
  // `!== undefined` check would silently treat a corrupted profile as
  // "configured" and activate the authority override — exactly the scenario
  // the samples-only draft fix in 964b3ff was meant to prevent.
  const hasExplicitConfig = profile.voiceDNA != null || profile.guardrails != null;
  return hasExplicitConfig && voiceProfileBlock.length > 0; // voice-authority-ok — helper body is the canonical authority site
}

export interface SeoContext {
  /** Keyword strategy block for AI prompts */
  keywordBlock: string;
  /**
   * Effective brand voice block. Always reflects the same source `fullContext`
   * uses — i.e. when a calibrated voice profile exists, this is the voice
   * profile block (formatted for AI prompt injection); otherwise it falls back
   * to the legacy `workspace.brandVoice` + brand-docs concatenation.
   *
   * This field used to lag behind `fullContext` (it always returned the legacy
   * source even when the voice profile took over). It is now kept consistent
   * so that direct readers of `brandVoiceBlock` can never see a different brand
   * voice than the one that was actually injected into the prompt.
   *
   * New callers should still prefer `fullContext`, which is the canonical
   * combined block.
   */
  brandVoiceBlock: string;
  /** Business context string (industry, location, services) */
  businessContext: string;
  /** Audience personas block for AI prompts */
  personasBlock: string;
  /** Knowledge base block for AI prompts */
  knowledgeBlock: string;
  /** All context blocks joined — drop this into any prompt for full business awareness */
  fullContext: string;
  /** Full strategy object (for direct access if needed) */
  strategy: KeywordStrategy | undefined;
}

// ── TTL cache for buildSeoContext (5-minute expiry) ──

const seoContextCache = new Map<string, { value: SeoContext; expiry: number }>();
const SEO_CONTEXT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Clear cached SEO context. Call when workspace settings change. */
export function clearSeoContextCache(workspaceId?: string): void {
  if (workspaceId) {
    // Clear all keys for this workspace (any pagePath variant)
    for (const key of seoContextCache.keys()) {
      if (key.startsWith(`${workspaceId}:`)) seoContextCache.delete(key);
    }
  } else {
    seoContextCache.clear();
  }
}

/**
 * Build SEO context from a workspace's keyword strategy.
 * Results are cached for 5 minutes per workspace+pagePath+learningsDomain combination.
 * @param workspaceId - workspace to look up
 * @param pagePath - optional page path to find page-specific keywords
 * @param learningsDomain - which learning domain to inject (default 'strategy'); pass 'content' from content generation callers
 */
export function buildSeoContext(
  workspaceId?: string,
  pagePath?: string,
  learningsDomain: 'content' | 'strategy' | 'technical' | 'all' = 'strategy',
  internalOpts?: { _skipShadow?: boolean },
): SeoContext {
  if (workspaceId) {
    const cacheKey = `${workspaceId}:${pagePath || ''}:${learningsDomain}`;
    const cached = seoContextCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) return cached.value;
  }
  const empty: SeoContext = { keywordBlock: '', brandVoiceBlock: '', businessContext: '', personasBlock: '', knowledgeBlock: '', fullContext: '', strategy: undefined };
  if (!workspaceId) return empty;

  const ws = getWorkspace(workspaceId);
  if (!ws) return empty;

  const strategy = ws.keywordStrategy;

  // --- Brand voice ---
  let brandVoiceBlock = '';
  const voiceParts: string[] = [];
  if (ws.brandVoice) voiceParts.push(ws.brandVoice);
  // Read any .txt/.md files from workspace brand-docs folder
  const brandDocsContent = readBrandDocs(ws.folder);
  if (brandDocsContent) voiceParts.push(brandDocsContent);
  if (voiceParts.length > 0) {
    brandVoiceBlock = `\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\n${voiceParts.join('\n\n')}`;
  }

  // Build personas + knowledge base (always, even without strategy)
  const personasBlock = buildPersonasContext(workspaceId);
  const knowledgeBlock = buildKnowledgeBase(workspaceId);

  if (!strategy) {
    const brandscriptBlock = buildBrandscriptContext(workspaceId);
    // Read the voice profile ONCE and reuse for both the authority check below
    // and the voice-profile block rendering. Passing it into
    // buildVoiceProfileContext avoids a second DB read on the hot prompt-assembly
    // path. Before this optimization, each buildSeoContext invocation read the
    // voice_profiles table twice (once here, once inside buildVoiceProfileContext)
    // — that's also a TOCTOU risk: a calibration transition landing between the
    // two reads could produce a mixed snapshot. One read = one snapshot.
    const profile = safeBrandEngineRead('buildSeoContext.noStrategy.getVoiceProfile', workspaceId, () => getVoiceProfile(workspaceId), null);
    const voiceProfileBlock = buildVoiceProfileContext(workspaceId, 'full', profile);
    const identityBlock = buildIdentityContext(workspaceId);
    // Authority decision: see `isVoiceProfileAuthoritative` for the full rules.
    // Samples alone do NOT trigger the override — a draft profile with just
    // uploaded samples is "preparing to calibrate", not a configuration
    // commitment.
    const effectiveBrandVoice = isVoiceProfileAuthoritative(profile, voiceProfileBlock) ? voiceProfileBlock : brandVoiceBlock;
    const baseParts = [effectiveBrandVoice, brandscriptBlock, identityBlock, personasBlock, knowledgeBlock].filter(Boolean);
    // Inject workspace learnings if feature is enabled
    if (isFeatureEnabled('outcome-ai-injection')) {
      const learnings = getWorkspaceLearnings(workspaceId);
      if (learnings) {
        const learningsBlock = formatLearningsForPrompt(learnings, learningsDomain);
        if (learningsBlock) baseParts.push(learningsBlock);
      }
    }
    const fullContext = baseParts.join('');
    const result: SeoContext = { keywordBlock: '', brandVoiceBlock: effectiveBrandVoice, businessContext: '', personasBlock, knowledgeBlock, fullContext, strategy: undefined };
    seoContextCache.set(`${workspaceId}:${pagePath || ''}:${learningsDomain}`, { value: result, expiry: Date.now() + SEO_CONTEXT_TTL_MS });
    return result;
  }

  let keywordBlock = '';

  // Site-level keywords
  const siteKw = strategy.siteKeywords?.slice(0, 8).join(', ');
  if (siteKw) keywordBlock += `Site target keywords: ${siteKw}`;

  // Business context (general — placed BEFORE page-specific so page keywords take priority)
  const businessContext = strategy.businessContext || '';
  if (businessContext) {
    keywordBlock += `\nGeneral business context: ${businessContext}`;
  }

  // Page-specific keywords (if pagePath provided) — these OVERRIDE general context
  if (pagePath) {
    const pageKw = getPageKeyword(workspaceId, pagePath);
    if (pageKw) {
      keywordBlock += `\n\nTHIS PAGE'S TARGET (overrides general context):`;
      keywordBlock += `\nPrimary keyword: "${pageKw.primaryKeyword}"`;
      if (pageKw.secondaryKeywords?.length) {
        keywordBlock += `\nSecondary keywords: ${pageKw.secondaryKeywords.join(', ')}`;
      }
      if (pageKw.searchIntent) {
        keywordBlock += `\nSearch intent: ${pageKw.searchIntent}`;
      }
      keywordBlock += `\nIMPORTANT: If this page's keywords reference a specific location (city, state, region), ALWAYS use THAT location. Do NOT substitute the business headquarters or a different location from the general business context. The page-level keyword is the authoritative signal for what this page targets.`;
    }
  }

  if (keywordBlock) {
    keywordBlock = `\n\nKEYWORD STRATEGY (incorporate these naturally):\n${keywordBlock}`;
  }

  const brandscriptBlock = buildBrandscriptContext(workspaceId);
  // Read the voice profile ONCE — see the `!strategy` branch above for rationale.
  const profile = safeBrandEngineRead('buildSeoContext.withStrategy.getVoiceProfile', workspaceId, () => getVoiceProfile(workspaceId), null);
  const voiceProfileBlock = buildVoiceProfileContext(workspaceId, 'full', profile);
  const identityBlock = buildIdentityContext(workspaceId);
  // Authority decision: see `isVoiceProfileAuthoritative` helper above for
  // the full rules. Shared with the no-strategy branch to prevent drift.
  const effectiveBrandVoice = isVoiceProfileAuthoritative(profile, voiceProfileBlock) ? voiceProfileBlock : brandVoiceBlock;
  const contextParts = [keywordBlock, effectiveBrandVoice, brandscriptBlock, identityBlock, personasBlock, knowledgeBlock].filter(Boolean);
  // Inject workspace learnings if feature is enabled
  if (isFeatureEnabled('outcome-ai-injection')) {
    const learnings = getWorkspaceLearnings(workspaceId);
    if (learnings) {
      const learningsBlock = formatLearningsForPrompt(learnings, learningsDomain);
      if (learningsBlock) contextParts.push(learningsBlock);
    }
  }
  const fullContext = contextParts.join('');
  const result: SeoContext = { keywordBlock, brandVoiceBlock: effectiveBrandVoice, businessContext, personasBlock, knowledgeBlock, fullContext, strategy };

  // Cache result
  if (workspaceId) {
    seoContextCache.set(`${workspaceId}:${pagePath || ''}:${learningsDomain}`, { value: result, expiry: Date.now() + SEO_CONTEXT_TTL_MS });
  }

  // Shadow-mode intelligence delegation (§14, §16)
  // Fire-and-forget — don't await, don't block the return.
  // ALWAYS returns the original result — shadow mode is observation-only.
  if (isFeatureEnabled('intelligence-shadow-mode') && workspaceId && !internalOpts?._skipShadow) {
    void (async () => {
      try {
        const { buildWorkspaceIntelligence } = await import('./workspace-intelligence.js'); // dynamic-import-ok — circular dep prevention in shadow-mode fire-and-forget
        const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'], pagePath, learningsDomain });

        if (intel.seoContext) {
          // Shadow-mode comparison: compare buildSeoContext() output against the
          // intelligence assembler's seoContext slice. Both sides originate from
          // the same source data. The assembler maps:
          //   brandVoice    = getRawBrandVoice() (raw, no header)
          //   knowledgeBase = getRawKnowledge() (raw, no header)
          // So we compare raw-to-raw (getRawBrandVoice vs intel.seoContext.brandVoice)
          // — this validates that the assembler reads from the same source data,
          // NOT that it produces the effective brand voice that ultimately ends
          // up in `result.brandVoiceBlock` / `fullContext`. When the voice
          // profile is authoritative (calibrated, OR non-empty block), the
          // effective voice is sourced from `buildVoiceProfileContext()` instead
          // of the raw legacy block, and the intelligence assembler does not yet
          // expose an equivalent field — so the raw-source check is skipped on
          // those workspaces to avoid logging an unrelated parity issue as a
          // real mismatch. The derivation matches the prompt-path check above
          // so shadow-mode and prompt-assembly stay in sync on what "voice
          // profile active" means.
          //
          // NOTE: shadow mode reads the profile FRESH here rather than reusing the
          // profile read on the main path above. This is intentional — shadow mode
          // runs asynchronously after the main result is already returned and
          // cached, so the main-path snapshot may be stale by the time this block
          // runs (e.g. a calibration transition landed in the meantime). Using the
          // current DB state is the whole point of a parity check. The profile IS
          // still passed into buildVoiceProfileContext below to avoid a fourth read
          // inside that helper. Wrapped in `safeBrandEngineRead` for consistency
          // with the main path — the outer try/catch in this shadow-mode block
          // catches EVERYTHING and only warn-logs, which would silently swallow
          // a real programming bug as a "shadow-mode comparison failed" warning.
          // The narrow wrapper re-throws non-schema-missing errors so the outer
          // catch still logs them, but the main path stays on the same gentle
          // degradation path it uses in production.
          const shadowProfile = safeBrandEngineRead('buildSeoContext.shadowMode.getVoiceProfile', workspaceId, () => getVoiceProfile(workspaceId), null);
          const shadowVoiceBlock = buildVoiceProfileContext(workspaceId, 'full', shadowProfile);
          // Use the same authority helper as the main path so shadow-mode's
          // decision to skip the raw brand voice parity check mirrors what
          // the main path actually did. Previously this site hand-rolled a
          // weaker version of the check (missing the `hasExplicitConfig`
          // gate added in the main path fix), causing parity checks to skip
          // the legacy brand-voice comparison on draft profiles that still
          // saw the legacy voice in production.
          const voiceProfileActive = isVoiceProfileAuthoritative(shadowProfile, shadowVoiceBlock);
          const comparisonFields: { name: string; match: boolean }[] = [
            { name: 'strategy', match: JSON.stringify(result.strategy) === JSON.stringify(intel.seoContext.strategy) },
            { name: 'businessContext', match: (result.businessContext ?? '') === (intel.seoContext.businessContext ?? '') },
            // Both are raw knowledge (no "BUSINESS KNOWLEDGE BASE" header)
            { name: 'knowledgeBase', match: getRawKnowledge(workspaceId) === (intel.seoContext.knowledgeBase ?? '') },
            // Personas: old path is prose string, new is structured array — compare presence as proxy
            { name: 'personas', match: (result.personasBlock ? 'present' : 'empty') === ((intel.seoContext.personas?.length ?? 0) > 0 ? 'present' : 'empty') },
          ];
          if (!voiceProfileActive) {
            // Both sides are raw legacy brand voice (no "BRAND VOICE & STYLE" header)
            comparisonFields.push({
              name: 'rawBrandVoice',
              match: getRawBrandVoice(workspaceId) === (intel.seoContext.brandVoice ?? ''),
            });
          }
          const mismatches = comparisonFields.filter(f => !f.match).map(f => f.name);
          if (mismatches.length > 0) {
            log.warn({ workspaceId, mismatches, totalFields: comparisonFields.length, voiceProfileActive }, 'Intelligence shadow-mode mismatch detected');
          } else {
            log.debug({ workspaceId, totalFields: comparisonFields.length, voiceProfileActive }, 'Intelligence shadow-mode: all fields match');
          }
        }
      } catch (err) {
        log.warn({ workspaceId, err }, 'Intelligence shadow-mode comparison failed');
      }
    })();
  }

  return result;
}

/**
 * Read .txt and .md files from a workspace's brand-docs/ folder.
 * Returns concatenated content (truncated to ~4000 chars to fit in prompts).
 */
function readBrandDocs(workspaceFolder: string): string {
  const brandDir = path.join(getUploadRoot(), workspaceFolder, 'brand-docs');

  if (!fs.existsSync(brandDir)) return '';

  try {
    const files = fs.readdirSync(brandDir).filter(f => /\.(txt|md)$/i.test(f)).sort();
    if (files.length === 0) return '';

    let content = '';
    for (const file of files) {
      const text = fs.readFileSync(path.join(brandDir, file), 'utf-8').trim();
      if (text) {
        content += `--- ${file} ---\n${text}\n\n`;
      }
      if (content.length > 4000) break;
    }
    return content.slice(0, 4000);
  } catch {
    return '';
  }
}

/**
 * Get raw brand voice content for a workspace (inline + brand-docs/ files, no header).
 * Use this when you need the raw text — e.g. for intelligence slice storage that adds its own header.
 */
export function getRawBrandVoice(workspaceId: string): string {
  const ws = getWorkspace(workspaceId);
  if (!ws) return '';
  const voiceParts: string[] = [];
  if (ws.brandVoice) voiceParts.push(ws.brandVoice);
  const brandDocsContent = readBrandDocs(ws.folder);
  if (brandDocsContent) voiceParts.push(brandDocsContent);
  return voiceParts.join('\n\n');
}

/**
 * Get raw knowledge content for a workspace (inline + knowledge-docs/ files, no header).
 * Use this when you need the raw text — e.g. for schema generation prompts that add their own header.
 */
export function getRawKnowledge(workspaceId: string): string {
  const ws = getWorkspace(workspaceId);
  if (!ws) return '';

  const parts: string[] = [];
  if (ws.knowledgeBase?.trim()) parts.push(ws.knowledgeBase.trim());
  const docsContent = readKnowledgeDocs(ws.folder);
  if (docsContent) parts.push(docsContent);
  return parts.join('\n\n');
}

/**
 * Build a global knowledge base block for AI chatbot prompts.
 * Combines the workspace's knowledgeBase field + any .txt/.md files in knowledge-docs/.
 */
export function buildKnowledgeBase(workspaceId?: string): string {
  if (!workspaceId) return '';
  const raw = getRawKnowledge(workspaceId);
  if (!raw) return '';
  return `\n\nBUSINESS KNOWLEDGE BASE (use this to give informed, business-aware answers):\n${raw}`;
}

/**
 * Read .txt and .md files from a workspace's knowledge-docs/ folder.
 */
function readKnowledgeDocs(workspaceFolder: string): string {
  const docsDir = path.join(getUploadRoot(), workspaceFolder, 'knowledge-docs');
  if (!fs.existsSync(docsDir)) return '';

  try {
    const files = fs.readdirSync(docsDir).filter(f => /\.(txt|md)$/i.test(f)).sort();
    if (files.length === 0) return '';

    let content = '';
    for (const file of files) {
      const text = fs.readFileSync(path.join(docsDir, file), 'utf-8').trim();
      if (text) {
        content += `--- ${file} ---\n${text}\n\n`;
      }
      if (content.length > 6000) break;
    }
    return content.slice(0, 6000);
  } catch {
    return '';
  }
}

/**
 * Shared instruction block for AI chat prompts — teaches the model to emit
 * rich fenced code blocks that the frontend renders as interactive components.
 */
export const RICH_BLOCKS_PROMPT = `
RICH RESPONSE BLOCKS — You can embed interactive visualizations in your responses using special fenced code blocks. Use them when they make data clearer, but don't force them — plain markdown is fine for simple answers.

\`\`\`metric
(single or array) {"label":"Total Clicks","value":1234,"change":12.5,"changeLabel":"vs last period","format":"number"}
Formats: "number" (default), "percent", "currency". "change" is a % delta (positive = green, negative = red).
For multiple metrics side by side, use an array: [{"label":"Clicks","value":1234},{"label":"CTR","value":3.2,"format":"percent"}]
\`\`\`

\`\`\`chart
{"type":"bar","title":"Top Pages by Clicks","data":[{"label":"/homepage","value":450},{"label":"/about","value":320}]}
Horizontal bar chart. Keep to 3-8 items. Use "valueFormat":"percent" if showing percentages.
\`\`\`

\`\`\`datatable
{"title":"Keyword Performance","headers":["Keyword","Clicks","Impressions","CTR"],"rows":[["seo agency",120,3400,"3.5%"],["web design",85,2100,"4.0%"]],"footer":"Showing top 5 of 48 keywords"}
Table with copy-to-CSV and download buttons. Use for detailed comparisons. Keep rows ≤ 10.
\`\`\`

RULES FOR RICH BLOCKS:
- The JSON must be valid and on a single logical block (newlines are fine inside the fenced block)
- Use rich blocks for: metric summaries, top-N comparisons, detailed breakdowns
- Do NOT use rich blocks for: simple yes/no answers, short explanations, or when you only have 1-2 data points
- You can mix rich blocks with normal markdown in the same response
- Always provide text context around blocks explaining what the data means
`;

/**
 * Build an audience personas block for AI prompts.
 * Returns structured persona data including pain points, goals, and objections.
 */
export function buildPersonasContext(workspaceId?: string): string {
  if (!workspaceId) return '';
  const ws = getWorkspace(workspaceId);
  if (!ws?.personas?.length) return '';

  const personaStr = ws.personas.map(p => {
    const parts = [`**${p.name}**${p.buyingStage ? ` (${p.buyingStage} stage)` : ''}: ${p.description}`];
    if (p.painPoints.length) parts.push(`  Pain points: ${p.painPoints.join('; ')}`);
    if (p.goals.length) parts.push(`  Goals: ${p.goals.join('; ')}`);
    if (p.objections.length) parts.push(`  Objections: ${p.objections.join('; ')}`);
    if (p.preferredContentFormat) parts.push(`  Prefers: ${p.preferredContentFormat}`);
    return parts.join('\n');
  }).join('\n\n');

  return `\n\nTARGET AUDIENCE PERSONAS (write to address these specific people — their pain points, goals, and objections):\n${personaStr}`;
}

/**
 * Build a page-specific analysis context block for AI rewrite prompts.
 * Pulls persisted optimizationIssues + recommendations from the keyword strategy pageMap.
 * This ensures AI rewrites address the platform's own recommendations.
 */
export function buildPageAnalysisContext(workspaceId?: string, pagePath?: string): string {
  if (!workspaceId || !pagePath) return '';

  const entry = getPageKeyword(workspaceId, pagePath);
  if (!entry) return '';

  const parts: string[] = [];

  // Core analysis data (original)
  if (entry.optimizationIssues?.length) {
    parts.push(`ISSUES IDENTIFIED:\n${entry.optimizationIssues.map(i => `- ${i}`).join('\n')}`);
  }
  if (entry.recommendations?.length) {
    parts.push(`RECOMMENDATIONS:\n${entry.recommendations.map(r => `- ${r}`).join('\n')}`);
  }
  if (entry.contentGaps?.length) {
    parts.push(`CONTENT GAPS:\n${entry.contentGaps.map(g => `- ${g}`).join('\n')}`);
  }

  // Extended analysis data (enriches AI prompt quality)
  if (entry.optimizationScore) {
    parts.push(`OPTIMIZATION SCORE: ${entry.optimizationScore}/100`);
  }
  if (entry.primaryKeywordPresence) {
    const p = entry.primaryKeywordPresence;
    const missing = (['inTitle', 'inMeta', 'inContent', 'inSlug'] as const)
      .filter(k => !p[k])
      .map(k => ({ inTitle: 'title tag', inMeta: 'meta description', inContent: 'page content', inSlug: 'URL slug' }[k]));
    if (missing.length > 0) {
      parts.push(`PRIMARY KEYWORD MISSING FROM: ${missing.join(', ')}`);
    }
  }
  if (entry.competitorKeywords?.length) {
    parts.push(`COMPETITOR KEYWORDS TO CONSIDER: ${entry.competitorKeywords.join(', ')}`);
  }
  if (entry.topicCluster) {
    parts.push(`TOPIC CLUSTER: ${entry.topicCluster}`);
  }
  if (entry.estimatedDifficulty) {
    parts.push(`ESTIMATED DIFFICULTY: ${entry.estimatedDifficulty}`);
  }

  if (parts.length === 0) return '';

  return `\n\nPAGE ANALYSIS (address these issues in your rewrite — this is what our platform flagged for this page):\n${parts.join('\n')}`;
}

/**
 * Build a full keyword map string for prompts that need cross-page awareness
 * (e.g., internal links, content briefs to avoid cannibalization).
 */
export function buildKeywordMapContext(workspaceId?: string): string {
  if (!workspaceId) return '';
  const pageMap = listPageKeywords(workspaceId);
  if (!pageMap.length) return '';

  const mapStr = pageMap.map(
    p => `${p.pagePath}: "${p.primaryKeyword}"${p.secondaryKeywords?.length ? ` (also: ${p.secondaryKeywords.slice(0, 3).join(', ')})` : ''}`
  ).join('\n');

  return `\n\nEXISTING KEYWORD MAP (avoid cannibalization, suggest internal links where relevant):\n${mapStr}`;
}

/**
 * Build a brand narrative block from the workspace's active brandscript.
 * Uses the most recently created brandscript. Returns '' if none exists or no sections have content.
 */
export function buildBrandscriptContext(workspaceId: string, emphasis: ContextEmphasis = 'full'): string {
  // Graceful degradation if brandscripts table doesn't exist (test envs).
  const scripts = safeBrandEngineRead('buildBrandscriptContext.listBrandscripts', workspaceId, () => listBrandscripts(workspaceId), []);
  if (scripts.length === 0) return '';

  const bs = scripts[0]; // Use most recent
  const filledSections = bs.sections.filter(sec => sec.content?.trim());

  if (filledSections.length === 0) return '';

  if (emphasis === 'minimal') {
    const first = filledSections[0];
    return `\n\nBRAND NARRATIVE (${bs.frameworkType}): ${first.title} — ${first.content?.slice(0, 200)}...`;
  }

  const sections = (emphasis === 'summary' ? filledSections.slice(0, 3) : filledSections)
    .map(sec => `  ${sec.title}: ${sec.content}`)
    .join('\n');

  return `\n\nBRAND NARRATIVE (${bs.frameworkType} framework):\n${sections}`;
}

/**
 * Build a voice profile block for AI prompts from the workspace's calibrated voice profile.
 * Includes voice DNA, sample writing, and guardrails. Returns '' if no profile exists.
 *
 * Guards on `profile.status === 'calibrated'`: when calibrated, buildSystemPrompt's
 * Layer 2 already injects DNA + guardrails into the system message. Re-injecting them
 * here would duplicate instructions and waste tokens.
 * When calibrated: returns only voice samples (safe at any status).
 * When not calibrated: returns the full DNA + samples + guardrails block.
 *
 * Hot-path optimization: callers that have already read the profile (e.g. `buildSeoContext`
 * which needs the profile independently for the authority rule) can pass it as `profileArg`
 * to avoid a second DB read. If omitted, the profile is fetched internally. Both paths
 * produce identical output — the parameter is a pure optimization, never a semantic change.
 *
 * Sentinel semantics: `profileArg === undefined` means "caller did not supply — fetch it";
 * `profileArg === null` means "caller already checked, no profile exists — skip the fetch
 * and return empty." We use `!== undefined` (strict) rather than a truthiness check because
 * `getVoiceProfile()` returns `VoiceProfile | null`, so `null` is a legitimate caller-supplied
 * value that must NOT trigger a re-read. A truthy check would re-read the DB for every caller
 * that correctly passed `null`, defeating the optimization.
 */
export function buildVoiceProfileContext(
  workspaceId: string,
  emphasis: ContextEmphasis = 'full',
  profileArg?: (VoiceProfile & { samples: VoiceSample[] }) | null,
): string {
  // Fallback fetch when the caller did not pre-fetch — wrapped in
  // `safeBrandEngineRead` so a missing `voice_profiles` table in test envs
  // degrades to the empty-voice path rather than crashing the entire
  // prompt-assembly call tree. Consistent with the wrapped reads inside
  // `buildSeoContext` / `buildBrandscriptContext` / `buildIdentityContext`.
  const profile = profileArg !== undefined
    ? profileArg
    : safeBrandEngineRead('buildVoiceProfileContext.fallback.getVoiceProfile', workspaceId, () => getVoiceProfile(workspaceId), null);
  if (!profile) return '';

  const isCalibrated = profile.status === 'calibrated';
  const parts: string[] = [];

  // `minimal` returns only a one-line voice summary (used by lightweight prompts).
  if (emphasis === 'minimal') {
    if (!profile.voiceDNA) return '';
    return `\n\nBRAND VOICE: ${renderVoiceDNASummary(profile.voiceDNA)}`;
  }

  const sampleLimit = emphasis === 'summary' ? 3 : 5;

  // Only inject DNA when not calibrated — Layer 2 handles it when calibrated.
  // Uses the shared `renderVoiceDNAForPrompt` helper so this path cannot drift
  // from voice-calibration.ts or prompt-assembly.ts. Adding a field to VoiceDNA
  // is a single-file change in voice-dna-render.ts; the compile fails here if
  // someone forgets.
  if (!isCalibrated && profile.voiceDNA) {
    parts.push(`VOICE DNA:`);
    parts.push(renderVoiceDNAForPrompt(profile.voiceDNA));
  }

  // Voice samples are safe to include at any status
  if (profile.samples.length > 0) {
    parts.push(`\nVOICE SAMPLES (write like these):`);
    for (const sample of profile.samples.slice(0, sampleLimit)) {
      parts.push(`  [${sample.contextTag || 'general'}] "${sample.content}"`);
    }
  }

  // Only inject guardrails when not calibrated — Layer 2 handles it when calibrated.
  // `summary` emphasis drops guardrails to keep the block compact.
  if (emphasis === 'full' && !isCalibrated && profile.guardrails) {
    parts.push(`\nGUARDRAILS:`);
    if (profile.guardrails.forbiddenWords.length) parts.push(`  Never use: ${profile.guardrails.forbiddenWords.join(', ')}`);
    if (profile.guardrails.requiredTerminology.length) parts.push(`  Required: ${profile.guardrails.requiredTerminology.map(t => `"${t.use}" not "${t.insteadOf}"`).join(', ')}`);
    if (profile.guardrails.toneBoundaries.length) parts.push(`  Boundaries: ${profile.guardrails.toneBoundaries.join('. ')}`);
  }

  if (parts.length === 0) return '';
  return `\n\nBRAND VOICE PROFILE (you MUST match this voice — do not deviate):\n${parts.join('\n')}`;
}

/**
 * Build a brand identity block for AI prompts from approved brand identity deliverables.
 * Only includes deliverables with status 'approved'. Returns '' if none exist.
 */
export function buildIdentityContext(workspaceId: string, emphasis: ContextEmphasis = 'full'): string {
  // Graceful degradation if brand_identity_deliverables table doesn't exist (test envs).
  const deliverables = safeBrandEngineRead('buildIdentityContext.listDeliverables', workspaceId, () => listDeliverables(workspaceId), [])
    .filter(d => d.status === 'approved');
  if (deliverables.length === 0) return '';

  if (emphasis === 'minimal') {
    const mission = deliverables.find(d => d.deliverableType === 'mission');
    return mission ? `\n\nBRAND MISSION: ${mission.content.slice(0, 200)}` : '';
  }

  const selected = emphasis === 'summary'
    ? deliverables.filter(d => ['mission', 'messaging_pillars', 'tagline'].includes(d.deliverableType))
    : deliverables;

  const parts: string[] = [];
  for (const d of selected) {
    parts.push(`  ${d.deliverableType.replace(/_/g, ' ').toUpperCase()}: ${d.content.slice(0, 500)}`);
  }

  if (parts.length === 0) return '';
  return `\n\nBRAND IDENTITY (approved deliverables):\n${parts.join('\n')}`;
}
