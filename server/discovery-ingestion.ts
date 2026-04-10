import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { callOpenAI } from './openai-helpers.js';
import { buildIntelPrompt } from './workspace-intelligence.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { randomUUID } from 'crypto';
import type {
  DiscoverySource, DiscoveryExtraction, SourceType,
  ExtractionType, ExtractionCategory, Confidence, ExtractionStatus, ExtractionDestination,
} from '../shared/types/brand-engine.js';

const log = createLogger('discovery-ingestion');

// ── Row types
interface SourceRow {
  id: string; workspace_id: string; filename: string; source_type: string;
  raw_content: string; processed_at: string | null; created_at: string;
}
interface ExtractionRow {
  id: string; source_id: string; workspace_id: string; extraction_type: string;
  category: string; content: string; source_quote: string | null;
  confidence: string; status: string; routed_to: string | null; created_at: string;
}

const stmts = createStmtCache(() => ({
  listSources: db.prepare(`SELECT * FROM discovery_sources WHERE workspace_id = ? ORDER BY created_at DESC`),
  getSource: db.prepare(`SELECT * FROM discovery_sources WHERE id = ? AND workspace_id = ?`),
  insertSource: db.prepare(`INSERT INTO discovery_sources (id, workspace_id, filename, source_type, raw_content, created_at) VALUES (@id, @workspace_id, @filename, @source_type, @raw_content, @created_at)`),
  markProcessed: db.prepare(`UPDATE discovery_sources SET processed_at = ? WHERE id = ?`),
  deleteSource: db.prepare(`DELETE FROM discovery_sources WHERE id = ? AND workspace_id = ?`),
  listExtractions: db.prepare(`SELECT * FROM discovery_extractions WHERE workspace_id = ? ORDER BY created_at DESC`),
  listExtractionsBySource: db.prepare(`SELECT * FROM discovery_extractions WHERE source_id = ? ORDER BY extraction_type, category`),
  insertExtraction: db.prepare(`INSERT INTO discovery_extractions (id, source_id, workspace_id, extraction_type, category, content, source_quote, confidence, status, created_at) VALUES (@id, @source_id, @workspace_id, @extraction_type, @category, @content, @source_quote, @confidence, @status, @created_at)`),
  updateExtractionStatus: db.prepare(`UPDATE discovery_extractions SET status = @status, routed_to = @routed_to WHERE id = @id AND workspace_id = @workspace_id`), // status-ok: extraction status is not a platform state machine column
  updateExtractionContent: db.prepare(`UPDATE discovery_extractions SET content = @content WHERE id = @id AND workspace_id = @workspace_id`),
}));

function confidenceForSourceType(sourceType: SourceType): Confidence {
  switch (sourceType) {
    case 'transcript': return 'high';
    case 'brand_doc': return 'medium';
    case 'competitor': return 'medium';
    case 'existing_copy': return 'low';
    case 'website_crawl': return 'low';
    default: return 'medium';
  }
}

function rowToSource(row: SourceRow): DiscoverySource {
  return {
    id: row.id, workspaceId: row.workspace_id, filename: row.filename,
    sourceType: row.source_type as SourceType, rawContent: row.raw_content,
    processedAt: row.processed_at ?? undefined, createdAt: row.created_at,
  };
}

function rowToExtraction(row: ExtractionRow): DiscoveryExtraction {
  return {
    id: row.id, sourceId: row.source_id, workspaceId: row.workspace_id,
    extractionType: row.extraction_type as ExtractionType,
    category: row.category as ExtractionCategory,
    content: row.content, sourceQuote: row.source_quote ?? undefined,
    confidence: row.confidence as Confidence,
    status: row.status as ExtractionStatus,
    routedTo: (row.routed_to ?? undefined) as ExtractionDestination | undefined,
    createdAt: row.created_at,
  };
}

export function listSources(workspaceId: string): DiscoverySource[] {
  return (stmts().listSources.all(workspaceId) as SourceRow[]).map(rowToSource);
}

export function listExtractions(workspaceId: string): DiscoveryExtraction[] {
  return (stmts().listExtractions.all(workspaceId) as ExtractionRow[]).map(rowToExtraction);
}

export function listExtractionsBySource(sourceId: string): DiscoveryExtraction[] {
  return (stmts().listExtractionsBySource.all(sourceId) as ExtractionRow[]).map(rowToExtraction);
}

export function addSource(workspaceId: string, filename: string, sourceType: SourceType, rawContent: string): DiscoverySource {
  const id = `src_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  stmts().insertSource.run({ id, workspace_id: workspaceId, filename, source_type: sourceType, raw_content: rawContent, created_at: now });
  log.info({ workspaceId, sourceId: id, sourceType }, 'added discovery source');
  return { id, workspaceId, filename, sourceType, rawContent, createdAt: now };
}

export function deleteSource(workspaceId: string, id: string): boolean {
  return stmts().deleteSource.run(id, workspaceId).changes > 0;
}

export function updateExtractionStatus(
  workspaceId: string, id: string, status: ExtractionStatus, routedTo?: ExtractionDestination,
): boolean {
  return stmts().updateExtractionStatus.run({ id, workspace_id: workspaceId, status, routed_to: routedTo ?? null }).changes > 0;
}

export function updateExtractionContent(workspaceId: string, id: string, content: string): boolean {
  return stmts().updateExtractionContent.run({ id, workspace_id: workspaceId, content }).changes > 0;
}

export async function processSource(workspaceId: string, sourceId: string): Promise<DiscoveryExtraction[]> {
  const row = stmts().getSource.get(sourceId, workspaceId) as SourceRow | undefined;
  if (!row) throw new Error('Source not found');

  const source = rowToSource(row);
  const confidence = confidenceForSourceType(source.sourceType);
  const fullContext = await buildIntelPrompt(workspaceId, ['seoContext']);

  const sourceLabel = source.sourceType === 'transcript'
    ? 'a discovery call transcript'
    : source.sourceType === 'competitor'
      ? 'competitor materials (extract what to AVOID, not emulate)'
      : source.sourceType === 'website_crawl'
        ? 'existing website copy (may reflect a previous copywriter, not the client\'s authentic voice)'
        : 'a brand document';

  const prompt = `You are a brand strategist analyzing ${sourceLabel} to extract brand intelligence.

BUSINESS CONTEXT:
${fullContext}

SOURCE CONTENT (${source.filename}):
${source.rawContent.slice(0, 12000)}

Extract two categories of intelligence:

1. VOICE PATTERNS — how the brand naturally communicates:
   - signature_phrase: memorable lines, catchphrases, repeated formulations
   - vocabulary: specific words they favor or avoid
   - tone_marker: humor style, formality level, energy
   - metaphor: analogies and comparisons they use to explain things
   - sentence_pattern: rhythm, length, structure preferences

2. STORY ELEMENTS — the narrative building blocks:
   - origin_story: why they started, founding motivation
   - customer_problem: pain points (external, internal, philosophical)
   - solution_framing: how they describe what they do differently
   - authority_marker: credentials, experience, proof points
   - empathy_signal: how they relate to customer frustrations
   - success_story: transformations and outcomes they describe
   - values_in_action: principles they reference naturally

For each extraction include a brief source_quote (the original text that supports it).
${source.sourceType === 'transcript' ? 'For transcripts, focus on what the CLIENT said (not the interviewer). Ignore filler words and small talk.' : ''}

Return valid JSON with this exact structure:
{
  "extractions": [
    {
      "extraction_type": "voice_pattern",
      "category": "signature_phrase",
      "content": "the extracted insight in 1-3 sentences",
      "source_quote": "brief quote from the source"
    }
  ]
}

Extract 8-15 high-quality extractions. Quality over quantity — skip anything generic or not specific to this brand.`;

  log.info({ workspaceId, sourceId, sourceType: source.sourceType }, 'processing source with AI');

  const result = await callOpenAI({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 4000,
    temperature: 0.2,
    responseFormat: { type: 'json_object' },
    feature: 'discovery-extraction',
    workspaceId,
  });

  const parsed = parseJsonFallback<{ extractions: { extraction_type: string; category: string; content: string; source_quote?: string }[] }>(
    result.text,
    { extractions: [] }
  );

  const now = new Date().toISOString();
  const extractions: DiscoveryExtraction[] = (parsed.extractions || []).map(ext => {
    const id = `ext_${randomUUID().slice(0, 8)}`;
    stmts().insertExtraction.run({
      id, source_id: sourceId, workspace_id: workspaceId,
      extraction_type: ext.extraction_type, category: ext.category,
      content: ext.content, source_quote: ext.source_quote ?? null,
      confidence, status: 'pending', created_at: now,
    });
    return {
      id, sourceId, workspaceId,
      extractionType: ext.extraction_type as ExtractionType,
      category: ext.category as ExtractionCategory,
      content: ext.content, sourceQuote: ext.source_quote,
      confidence, status: 'pending' as ExtractionStatus, createdAt: now,
    };
  });

  stmts().markProcessed.run(now, sourceId);
  log.info({ workspaceId, sourceId, count: extractions.length }, 'extracted insights');
  return extractions;
}
