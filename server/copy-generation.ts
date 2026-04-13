// server/copy-generation.ts
// 8-layer context assembly and AI copy generation engine for the Copy Pipeline.

import { createLogger } from './logger.js';
import { callAnthropic } from './anthropic-helpers.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { getVoiceProfile, buildVoiceCalibrationContext } from './voice-calibration.js';
import { listDeliverables } from './brand-identity.js';
import { listBrandscripts } from './brandscript.js';
import { generateBrief, getPageTypeConfig } from './content-brief.js';
import { getBlueprint, getEntry, listBlueprints } from './page-strategy.js';
import {
  buildWorkspaceIntelligence,
  formatKeywordsForPrompt,
  formatPersonasForPrompt,
  formatKnowledgeBaseForPrompt,
} from './workspace-intelligence.js';
import { getActivePatterns } from './copy-intelligence.js';
import { WRITING_QUALITY_RULES } from './content-posts-ai.js';
import { parseJsonFallback } from './db/json-validation.js';
import db from './db/index.js';
import {
  initializeSections,
  saveGeneratedCopy,
  saveMetadata,
  addSteeringEntry,
  getSectionsForEntry,
} from './copy-review.js';
import type { CopySection, CopyMetadata, QualityFlag, GeneratedPageCopy } from '../shared/types/copy-pipeline.js';
import type { SectionPlanItem, SiteBlueprint, BlueprintEntry } from '../shared/types/page-strategy.js';
import type { IntelligencePatternType } from '../shared/types/copy-pipeline.js';

const log = createLogger('copy-generation');

// ── Public API ──

/**
 * Generates copy for ALL sections of a blueprint entry.
 * Initializes sections (idempotent), builds 8-layer context, calls Claude,
 * saves results, and returns the saved sections + metadata.
 */
export async function generateCopyForEntry(
  wsId: string,
  blueprintId: string,
  entryId: string,
  accumulatedSteering?: string[],
): Promise<{ sections: CopySection[]; metadata: CopyMetadata }> {
  const blueprint = getBlueprint(wsId, blueprintId);
  if (!blueprint) throw new Error(`Blueprint not found: ${blueprintId}`);

  const entry = getEntry(wsId, blueprintId, entryId);
  if (!entry) throw new Error(`Entry not found: ${entryId}`);

  // Build context (uses getSectionsForEntry internally for cross-page awareness)
  const context = await buildCopyGenerationContext(wsId, blueprint, entry, accumulatedSteering);

  // Extract guardrailsText from voice profile for quality checks
  let guardrailsText: string | undefined;
  try {
    const profile = getVoiceProfile(wsId);
    if (profile) {
      const voiceCtx = buildVoiceCalibrationContext(profile);
      if (voiceCtx.guardrailsText) guardrailsText = voiceCtx.guardrailsText;
    }
  } catch {
    // voice_profiles table may not exist in all environments — graceful degradation
  }

  // Build system prompt (includes voice DNA via buildSystemPrompt)
  const sectionDescriptions = entry.sectionPlan
    .map(s => `- ${s.sectionType} (${s.wordCountTarget ?? 150} words, role: ${s.narrativeRole ?? 'custom'})`)
    .join('\n');

  const baseInstructions = `You are an expert copywriter generating website copy for ${blueprint.name}.

Generate copy for these sections:
${sectionDescriptions}

Return a JSON object with this exact structure:
{
  "sections": [
    {
      "sectionPlanItemId": "string (the exact ID from the section plan)",
      "copy": "string (the generated copy)",
      "annotation": "string (brief note on approach)",
      "reasoning": "string (why this copy fits the brief)"
    }
  ],
  "seoTitle": "string (60 chars max)",
  "metaDescription": "string (155 chars max)",
  "ogTitle": "string",
  "ogDescription": "string"
}

IMPORTANT: Return ONLY valid JSON. No markdown fences, no prose before or after.

Context:
${context}`;

  const systemPrompt = buildSystemPrompt(wsId, baseInstructions);

  const response = await callAnthropic({
    model: 'claude-sonnet-4-20250514',
    maxTokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Generate copy for "${entry.name}" (${entry.pageType} page). Return only valid JSON.` }],
    feature: 'copy-generation',
    workspaceId: wsId,
  });

  // Parse response — callAnthropic returns { text, ... }
  const cleaned = response.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const generated = parseJsonFallback<GeneratedPageCopy | null>(cleaned, null);
  if (!generated || !Array.isArray(generated.sections)) {
    log.error({ entryId, blueprintId }, 'Failed to parse generation response');
    throw new Error('Copy generation failed: invalid AI response format');
  }

  // AI call succeeded — now initialize sections and save in a single transaction.
  // Deferred initialization prevents data loss: if the AI call above fails,
  // previously approved copy is preserved.
  const { sections: savedSections, metadata } = db.transaction(() => {
    const initialSections = initializeSections(wsId, entryId, entry.sectionPlan);

    const sections: (CopySection | null)[] = generated.sections.map((s) => {
      const section = initialSections.find(sec => sec.sectionPlanItemId === s.sectionPlanItemId);
      if (!section) return null;
      const sectionPlan = entry.sectionPlan.find(p => p.id === s.sectionPlanItemId);
      const qualityFlags = sectionPlan ? runQualityCheck(s.copy, sectionPlan, guardrailsText) : [];
      return saveGeneratedCopy(section.id, wsId, {
        generatedCopy: s.copy,
        aiAnnotation: s.annotation,
        aiReasoning: s.reasoning,
        qualityFlags: qualityFlags.length > 0 ? qualityFlags : undefined,
      });
    });

    const meta = saveMetadata(entryId, wsId, {
      seoTitle: generated.seoTitle,
      metaDescription: generated.metaDescription,
      ogTitle: generated.ogTitle,
      ogDescription: generated.ogDescription,
    });

    return { sections, metadata: meta };
  })();

  return {
    sections: savedSections.filter((s): s is CopySection => s !== null),
    metadata,
  };
}

/**
 * Regenerates a single section with a steering note.
 * Saves the steering entry first, then calls Claude for the revised copy.
 */
export async function regenerateSection(
  wsId: string,
  blueprintId: string,
  entryId: string,
  sectionId: string,
  steeringNote: string,
  highlight?: string,
): Promise<CopySection | null> {
  const blueprint = getBlueprint(wsId, blueprintId);
  const entry = getEntry(wsId, blueprintId, entryId);
  const sections = getSectionsForEntry(entryId, wsId);
  const targetSection = sections.find(s => s.id === sectionId);
  if (!blueprint || !entry || !targetSection) return null;

  const sectionPlanItem = entry.sectionPlan.find(p => p.id === targetSection.sectionPlanItemId);
  if (!sectionPlanItem) return null;

  // Save the steering entry first
  addSteeringEntry(sectionId, wsId, {
    type: highlight ? 'highlight' : 'note',
    note: steeringNote,
    highlight,
    resultVersion: targetSection.version,
  });

  // Build targeted regeneration prompt
  const context = await buildCopyGenerationContext(wsId, blueprint, entry);
  const baseInstructions = `You are regenerating a single section of website copy based on steering feedback.

Section type: ${sectionPlanItem.sectionType}
Narrative role: ${sectionPlanItem.narrativeRole ?? 'custom'}
Word count target: ${sectionPlanItem.wordCountTarget ?? 150}
Current copy: ${targetSection.generatedCopy ?? '(none)'}
Steering note: ${steeringNote}
${highlight ? `Highlighted text to focus on: "${highlight}"` : ''}

Return JSON: { "copy": "string", "annotation": "string", "reasoning": "string" }
IMPORTANT: Return ONLY valid JSON. No markdown fences, no prose before or after.

Context:
${context}`;

  const systemPrompt = buildSystemPrompt(wsId, baseInstructions);

  const response = await callAnthropic({
    model: 'claude-sonnet-4-20250514',
    maxTokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Regenerate this section. Return only valid JSON.' }],
    feature: 'copy-regeneration',
    workspaceId: wsId,
  });

  const regenCleaned = response.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const result = parseJsonFallback<{ copy: string; annotation: string; reasoning: string } | null>(
    regenCleaned,
    null,
  );
  if (!result || !result.copy) {
    log.error({ sectionId }, 'Failed to parse regeneration response');
    return null;
  }

  // Extract guardrailsText from voice profile for quality checks
  let guardrailsText: string | undefined;
  try {
    const profile = getVoiceProfile(wsId);
    if (profile) {
      const voiceCtx = buildVoiceCalibrationContext(profile);
      if (voiceCtx.guardrailsText) guardrailsText = voiceCtx.guardrailsText;
    }
  } catch {
    // voice_profiles table may not exist in all environments — graceful degradation
  }

  // Save in a transaction so copy + metadata are atomic
  return db.transaction(() => {
    const qualityFlags = runQualityCheck(result.copy, sectionPlanItem, guardrailsText);
    return saveGeneratedCopy(sectionId, wsId, {
      generatedCopy: result.copy,
      aiAnnotation: result.annotation,
      aiReasoning: result.reasoning,
      qualityFlags: qualityFlags.length > 0 ? qualityFlags : undefined,
    });
  })();
}

/**
 * Pure quality check — no AI call.
 * Returns an array of quality flags for the given copy + section plan.
 */
export function runQualityCheck(
  copy: string,
  sectionPlan: SectionPlanItem,
  guardrailsText?: string,
): QualityFlag[] {
  const flags: QualityFlag[] = [];

  // 1. Forbidden phrases (drawn from WRITING_QUALITY_RULES and common AI clichés)
  const forbiddenPhrases = [
    'cutting-edge',
    'seamlessly',
    'leverage',
    'synergy',
    'game-changer',
    'revolutionize',
    'paradigm shift',
    'best-in-class',
    'world-class',
    'game-changing',
    'next-level',
    'unlock the power of',
    'move the needle',
    'deep dive',
    'silver bullet',
    'secret sauce',
  ];
  for (const phrase of forbiddenPhrases) {
    if (copy.toLowerCase().includes(phrase.toLowerCase())) {
      flags.push({
        type: 'forbidden_phrase',
        message: `Contains forbidden phrase: "${phrase}"`,
        severity: 'warning',
      });
    }
  }

  // 2. Word count check (flag if 50% over or under target)
  if (sectionPlan.wordCountTarget) {
    const wordCount = copy.split(/\s+/).filter(Boolean).length;
    const target = sectionPlan.wordCountTarget;
    if (wordCount < target * 0.5) {
      flags.push({
        type: 'word_count_violation',
        message: `Too short: ${wordCount} words (target: ${target})`,
        severity: 'warning',
      });
    } else if (wordCount > target * 1.5) {
      flags.push({
        type: 'word_count_violation',
        message: `Too long: ${wordCount} words (target: ${target})`,
        severity: 'warning',
      });
    }
  }

  // 3. Keyword stuffing (same word 4+ times)
  const words = copy.toLowerCase().split(/\s+/);
  const wordFreq: Record<string, number> = {};
  for (const w of words) {
    if (w.length > 4) wordFreq[w] = (wordFreq[w] ?? 0) + 1;
  }
  for (const [word, count] of Object.entries(wordFreq)) {
    if (count >= 4) {
      flags.push({
        type: 'keyword_stuffing',
        message: `Keyword "${word}" appears ${count} times`,
        severity: 'warning',
      });
    }
  }

  // 4. Guardrail violations — check forbidden words from voice profile guardrails
  if (guardrailsText) {
    // Extract "Never use:" list if present (matches the guardrailsToPromptInstructions format)
    const neverUseMatch = guardrailsText.match(/Never use:\s*(.+)/i);
    if (neverUseMatch) {
      const forbidden = neverUseMatch[1].split(',').map(w => w.trim()).filter(Boolean);
      for (const term of forbidden) {
        if (copy.toLowerCase().includes(term.toLowerCase())) {
          flags.push({
            type: 'guardrail_violation',
            message: `Uses guardrail-forbidden term: "${term}"`,
            severity: 'error',
          });
        }
      }
    }
  }

  return flags;
}

/**
 * Assembles the 8-layer context string for copy generation.
 * Can be used for generation, regeneration, or preview/debug.
 */
export async function buildCopyGenerationContext(
  wsId: string,
  blueprint: SiteBlueprint,
  entry: BlueprintEntry,
  accumulatedSteering?: string[],
): Promise<string> {
  const parts: string[] = [];

  // ── Layer 1: Brand Foundation ──
  try {
    const brandscripts = listBrandscripts(wsId);
    if (brandscripts.length > 0) {
      const bs = brandscripts[0];
      const filled = bs.sections.filter(s => s.content?.trim());
      if (filled.length > 0) {
        parts.push(
          `BRAND FOUNDATION (${bs.frameworkType}):\n${filled
            .map(s => `${s.title}: ${s.content}`)
            .join('\n')}`,
        );
      }
    }
  } catch {
    // brandscript table may not exist in all environments — graceful degradation
  }

  // ── Layer 2: Voice DNA (user-prompt portion) ──
  // buildSystemPrompt() handles Layer 2 auto-injection for calibrated profiles.
  // Here we include samples + draft DNA for non-calibrated profiles.
  try {
    const profile = getVoiceProfile(wsId);
    if (profile) {
      const { samplesText, dnaText, guardrailsText } = buildVoiceCalibrationContext(profile);
      const voiceParts = [samplesText, dnaText, guardrailsText].filter(Boolean);
      if (voiceParts.length > 0) {
        parts.push(`VOICE CALIBRATION:${voiceParts.join('')}`);
      }
    }
  } catch {
    // voice_profiles table may not exist in all environments — graceful degradation
  }

  // ── Layer 3: Brand Identity (approved deliverables) ──
  try {
    const deliverables = listDeliverables(wsId).filter(d => d.status === 'approved');
    if (deliverables.length > 0) {
      const deliverableLines = deliverables
        .map(d => `[${d.deliverableType}] ${d.content}`)
        .join('\n\n');
      parts.push(`BRAND IDENTITY DELIVERABLES:\n${deliverableLines}`);
    }
  } catch {
    // brand_identity_deliverables table may not exist in all environments — graceful degradation
  }

  // ── Layer 4: Page Strategy ──
  const strategyParts: string[] = [];
  strategyParts.push(`Site: ${blueprint.name}${blueprint.industryType ? ` (${blueprint.industryType})` : ''}`);
  if (entry.primaryKeyword) {
    strategyParts.push(`Primary keyword: ${entry.primaryKeyword}`);
  }
  if (entry.secondaryKeywords && entry.secondaryKeywords.length > 0) {
    strategyParts.push(`Secondary keywords: ${entry.secondaryKeywords.join(', ')}`);
  }
  strategyParts.push(`Page type: ${entry.pageType}`);
  if (entry.sectionPlan.length > 0) {
    const planLines = entry.sectionPlan
      .map(
        s =>
          `  [${s.id}] ${s.sectionType}${s.narrativeRole ? ` — ${s.narrativeRole}` : ''}` +
          `${s.wordCountTarget ? ` (${s.wordCountTarget} words)` : ''}` +
          `${s.brandNote ? ` | brand: ${s.brandNote}` : ''}` +
          `${s.seoNote ? ` | seo: ${s.seoNote}` : ''}`,
      )
      .join('\n');
    strategyParts.push(`Section plan:\n${planLines}`);
  }
  if (entry.notes) {
    strategyParts.push(`Entry notes: ${entry.notes}`);
  }
  parts.push(`PAGE STRATEGY:\n${strategyParts.join('\n')}`);

  // ── Layer 4.5: Brief enrichment ──
  if (entry.primaryKeyword) {
    try {
      const brief = await generateBrief(wsId, entry.primaryKeyword, {
        pageType: entry.pageType,
      });
      const briefLines: string[] = [];
      if (brief.suggestedTitle) briefLines.push(`Suggested title: ${brief.suggestedTitle}`);
      if (brief.executiveSummary) briefLines.push(`Executive summary: ${brief.executiveSummary}`);
      if (brief.toneAndStyle) briefLines.push(`Tone & style: ${brief.toneAndStyle}`);
      if (brief.contentFormat) briefLines.push(`Content format: ${brief.contentFormat}`);
      if (brief.intent) briefLines.push(`Search intent: ${brief.intent}`);
      if (brief.audience) briefLines.push(`Audience: ${brief.audience}`);
      if (brief.secondaryKeywords?.length > 0) {
        briefLines.push(`Secondary keywords: ${brief.secondaryKeywords.slice(0, 8).join(', ')}`);
      }
      if (brief.ctaRecommendations && brief.ctaRecommendations.length > 0) {
        briefLines.push(`CTA recommendations: ${brief.ctaRecommendations.join('; ')}`);
      }
      if (briefLines.length > 0) {
        parts.push(`CONTENT BRIEF ENRICHMENT:\n${briefLines.join('\n')}`);
      }
    } catch (err) {
      log.warn({ wsId, entryId: entry.id, keyword: entry.primaryKeyword }, 'Brief enrichment failed — skipping', err instanceof Error ? err.message : String(err));
    }
  }

  // ── Layer 5: Cross-Page Awareness ──
  try {
    const allBlueprints = listBlueprints(wsId);
    const approvedSections: string[] = [];
    for (const bp of allBlueprints) {
      if (!bp.entries) continue;
      for (const e of bp.entries) {
        if (e.id === entry.id) continue; // skip current entry
        const entrySections = getSectionsForEntry(e.id, wsId);
        const approved = entrySections.filter(s => s.status === 'approved' && s.generatedCopy);
        for (const sec of approved.slice(0, 2)) {
          // Pull section plan item for context
          const planItem = e.sectionPlan.find(p => p.id === sec.sectionPlanItemId);
          if (planItem) {
            approvedSections.push(
              `[${e.name} / ${planItem.sectionType}]: ${(sec.generatedCopy ?? '').slice(0, 200)}...`,
            );
          }
        }
      }
    }
    if (approvedSections.length > 0) {
      parts.push(
        `CROSS-PAGE CONSISTENCY (approved copy from other pages — match tone and avoid repetition):\n${approvedSections.slice(0, 6).join('\n\n')}`,
      );
    }
  } catch {
    // graceful degradation
  }

  // ── Layer 6: SEO Intelligence ──
  try {
    const intel = await buildWorkspaceIntelligence(wsId, { slices: ['seoContext'] });
    const seoSlice = intel.seoContext;
    if (seoSlice) {
      const seoParts: string[] = [];
      const keywordBlock = formatKeywordsForPrompt(seoSlice);
      if (keywordBlock.trim()) seoParts.push(keywordBlock);
      if (seoSlice.effectiveBrandVoiceBlock.trim()) seoParts.push(seoSlice.effectiveBrandVoiceBlock);
      if (seoSlice.businessContext.trim()) seoParts.push(`Business context: ${seoSlice.businessContext}`);
      const personasBlock = formatPersonasForPrompt(seoSlice.personas);
      if (personasBlock.trim()) seoParts.push(personasBlock);
      const knowledgeBlock = formatKnowledgeBaseForPrompt(seoSlice.knowledgeBase);
      if (knowledgeBlock.trim()) seoParts.push(knowledgeBlock);
      if (seoParts.length > 0) {
        parts.push(`SEO INTELLIGENCE:\n${seoParts.join('\n\n')}`);
      }
    }
  } catch {
    // graceful degradation
  }

  // ── Layer 7: Copy Intelligence Patterns ──
  try {
    const patterns = getActivePatterns(wsId);
    if (patterns.length > 0) {
      // Group by type
      const grouped: Partial<Record<IntelligencePatternType, string[]>> = {};
      for (const p of patterns) {
        if (!grouped[p.patternType]) grouped[p.patternType] = [];
        grouped[p.patternType]!.push(p.pattern);
      }
      const patternLines = (Object.entries(grouped) as [IntelligencePatternType, string[]][])
        .map(([type, items]) => `${type.toUpperCase()}:\n${items.map(i => `  - ${i}`).join('\n')}`)
        .join('\n');
      parts.push(`COPY INTELLIGENCE PATTERNS (learned from previous generation feedback):\n${patternLines}`);
    }
  } catch {
    // copy_intelligence table may not exist in all environments — graceful degradation
  }

  // ── Layer 8: Generation Rules ──
  const pageTypeConfig = getPageTypeConfig(entry.pageType);
  const generationRules: string[] = [
    WRITING_QUALITY_RULES,
    `PAGE-TYPE GUIDANCE (${entry.pageType}):`,
    `- Word count range: ${pageTypeConfig.wordCountRange}`,
    `- Content style: ${pageTypeConfig.contentStyle}`,
    pageTypeConfig.prompt,
  ];
  parts.push(`GENERATION RULES:\n${generationRules.join('\n')}`);

  // ── Layer 8.5: Accumulated steering ──
  if (accumulatedSteering && accumulatedSteering.length > 0) {
    parts.push(
      `ACCUMULATED STEERING (from previous iterations — apply these learnings):\n${accumulatedSteering.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    );
  }

  return parts.join('\n\n---\n\n');
}
