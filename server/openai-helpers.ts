/**
 * Shared OpenAI helper utilities — retry logic, rate-limit handling, and token tracking.
 * All AI features should use these instead of raw fetch() calls.
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from './data-dir.js';

// --- Token / Cost Tracking (persisted to disk) ---

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  feature: string;
  workspaceId?: string;
  timestamp: string;
  durationMs?: number;
}

const USAGE_DIR = getDataDir('ai-usage');
const MAX_MEMORY_LOG = 1000;
let usageLog: TokenUsage[] = [];

// Load today's usage from disk on startup
function getUsageFilePath(date: string): string {
  return path.join(USAGE_DIR, `${date}.json`);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Load existing usage files into memory (last 30 days)
(function loadRecentUsage() {
  try {
    const files = fs.readdirSync(USAGE_DIR).filter(f => f.endsWith('.json')).sort().slice(-30);
    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(USAGE_DIR, f), 'utf-8'));
      if (Array.isArray(data)) usageLog.push(...data);
    }
    if (usageLog.length > MAX_MEMORY_LOG) usageLog = usageLog.slice(-MAX_MEMORY_LOG);
  } catch { /* first run or corrupt files */ }
})();

// Flush buffer: append to today's file periodically
let pendingWrites: TokenUsage[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushToDisk(): void {
  if (pendingWrites.length === 0) return;
  const today = todayStr();
  const filePath = getUsageFilePath(today);
  let existing: TokenUsage[] = [];
  try { existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { /* new file */ }
  existing.push(...pendingWrites);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
  pendingWrites = [];
}

export function logTokenUsage(usage: Omit<TokenUsage, 'timestamp'>): void {
  const entry = { ...usage, timestamp: new Date().toISOString() };
  usageLog.push(entry);
  if (usageLog.length > MAX_MEMORY_LOG) usageLog.splice(0, usageLog.length - MAX_MEMORY_LOG);
  pendingWrites.push(entry);
  // Debounce disk writes (flush every 5s or after 20 entries)
  if (pendingWrites.length >= 20) { flushToDisk(); return; }
  if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flushToDisk(); }, 5000);
}

// Flush on process exit
process.on('beforeExit', flushToDisk);
process.on('SIGINT', () => { flushToDisk(); process.exit(0); });
process.on('SIGTERM', () => { flushToDisk(); process.exit(0); });

// --- Cost estimation per model ---

/** Per-token pricing (USD). Updated March 2026. */
function estimateCost(entry: TokenUsage): number {
  const m = entry.model;
  // GPT-4.1 nano
  if (m.includes('nano')) return (entry.promptTokens * 0.0000001) + (entry.completionTokens * 0.0000004);
  // GPT-4.1 mini
  if (m.includes('mini')) return (entry.promptTokens * 0.0000004) + (entry.completionTokens * 0.0000016);
  // GPT-4.1
  if (m.startsWith('gpt-4.1')) return (entry.promptTokens * 0.000002) + (entry.completionTokens * 0.000008);
  // Claude Sonnet 4
  if (m.includes('claude-sonnet-4')) return (entry.promptTokens * 0.000003) + (entry.completionTokens * 0.000015);
  // Claude 3.5 Sonnet
  if (m.includes('claude-3-5-sonnet')) return (entry.promptTokens * 0.000003) + (entry.completionTokens * 0.000015);
  // Claude 3.5 Haiku
  if (m.includes('claude-3-5-haiku')) return (entry.promptTokens * 0.0000008) + (entry.completionTokens * 0.000004);
  // Fallback: GPT-4.1 pricing
  return (entry.promptTokens * 0.000002) + (entry.completionTokens * 0.000008);
}

function getProvider(model: string): 'openai' | 'anthropic' {
  return model.includes('claude') ? 'anthropic' : 'openai';
}

/** Get recent token usage, optionally filtered by workspace */
export function getTokenUsage(workspaceId?: string, since?: string): { entries: TokenUsage[]; totalTokens: number; estimatedCost: number } {
  let entries = usageLog;
  if (workspaceId) entries = entries.filter(e => e.workspaceId === workspaceId);
  if (since) entries = entries.filter(e => e.timestamp >= since);
  const totalTokens = entries.reduce((s, e) => s + e.totalTokens, 0);
  const estimatedCost = entries.reduce((s, e) => s + estimateCost(e), 0);
  return { entries, totalTokens, estimatedCost };
}

/** Aggregate usage by day for charting */
export function getUsageByDay(workspaceId?: string, days = 30): Array<{
  date: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  calls: number;
  openaiCost: number;
  anthropicCost: number;
  openaiTokens: number;
  anthropicTokens: number;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const since = cutoff.toISOString();

  let entries = usageLog.filter(e => e.timestamp >= since);
  if (workspaceId) entries = entries.filter(e => e.workspaceId === workspaceId);

  const byDay = new Map<string, {
    totalTokens: number; promptTokens: number; completionTokens: number;
    cost: number; calls: number; openaiCost: number; anthropicCost: number;
    openaiTokens: number; anthropicTokens: number;
  }>();

  for (const e of entries) {
    const day = e.timestamp.slice(0, 10);
    const existing = byDay.get(day) || {
      totalTokens: 0, promptTokens: 0, completionTokens: 0,
      cost: 0, calls: 0, openaiCost: 0, anthropicCost: 0,
      openaiTokens: 0, anthropicTokens: 0,
    };
    const cost = estimateCost(e);
    const provider = getProvider(e.model);
    existing.totalTokens += e.totalTokens;
    existing.promptTokens += e.promptTokens;
    existing.completionTokens += e.completionTokens;
    existing.cost += cost;
    existing.calls += 1;
    if (provider === 'openai') { existing.openaiCost += cost; existing.openaiTokens += e.totalTokens; }
    else { existing.anthropicCost += cost; existing.anthropicTokens += e.totalTokens; }
    byDay.set(day, existing);
  }

  // Fill missing days with zeros
  const result: Array<{ date: string; totalTokens: number; promptTokens: number; completionTokens: number; cost: number; calls: number; openaiCost: number; anthropicCost: number; openaiTokens: number; anthropicTokens: number }> = [];
  const d = new Date(cutoff);
  const today = new Date();
  while (d <= today) {
    const dayStr = d.toISOString().slice(0, 10);
    result.push({ date: dayStr, ...(byDay.get(dayStr) || {
      totalTokens: 0, promptTokens: 0, completionTokens: 0,
      cost: 0, calls: 0, openaiCost: 0, anthropicCost: 0,
      openaiTokens: 0, anthropicTokens: 0,
    })});
    d.setDate(d.getDate() + 1);
  }
  return result;
}

/** Aggregate usage by feature for breakdown */
export function getUsageByFeature(workspaceId?: string, since?: string): Array<{
  feature: string; calls: number; totalTokens: number; cost: number; provider: string;
}> {
  let entries = usageLog;
  if (workspaceId) entries = entries.filter(e => e.workspaceId === workspaceId);
  if (since) entries = entries.filter(e => e.timestamp >= since);

  const byFeature = new Map<string, { calls: number; totalTokens: number; cost: number; provider: string }>();
  for (const e of entries) {
    const key = `${e.feature}|${getProvider(e.model)}`;
    const existing = byFeature.get(key) || { calls: 0, totalTokens: 0, cost: 0, provider: getProvider(e.model) };
    existing.calls += 1;
    existing.totalTokens += e.totalTokens;
    existing.cost += estimateCost(e);
    byFeature.set(key, existing);
  }

  return Array.from(byFeature.entries())
    .map(([key, v]) => ({ feature: key.split('|')[0], ...v }))
    .sort((a, b) => b.cost - a.cost);
}

// --- Retry-enabled OpenAI call ---

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; [key: string]: unknown }>;
}

interface OpenAIChatOptions {
  model?: 'gpt-4.1-nano' | 'gpt-4.1-mini' | 'gpt-4.1' | 'gpt-4o-mini' | 'gpt-4o';
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Label for logging (e.g. 'seo-rewrite', 'schema-gen') */
  feature: string;
  /** Workspace ID for cost tracking */
  workspaceId?: string;
  /** Max retry attempts on 429/5xx (default 3) */
  maxRetries?: number;
  /** Timeout per request in ms (default 60000) */
  timeoutMs?: number;
}

interface OpenAIChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Call OpenAI Chat Completions with automatic retry on 429/5xx,
 * exponential backoff, timeout, and token tracking.
 */
export async function callOpenAI(opts: OpenAIChatOptions): Promise<OpenAIChatResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const {
    model = 'gpt-4.1-mini',
    messages,
    maxTokens = 1000,
    temperature = 0.7,
    feature,
    workspaceId,
    maxRetries = 3,
    timeoutMs = 60_000,
  } = opts;

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  });

  const callStartMs = Date.now();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');

        // Quota exceeded — never retryable, fail fast
        if (res.status === 429 && errText.includes('insufficient_quota')) {
          console.error(`[${feature}] OpenAI quota exceeded — add credits at platform.openai.com/account/billing`);
          throw new Error(`OpenAI quota exceeded. Add credits at https://platform.openai.com/account/billing`);
        }

        const isRetryable = res.status === 429 || res.status >= 500;
        if (isRetryable && attempt < maxRetries) {
          // Parse retry-after header if available
          const retryAfterMs = res.headers.get('retry-after-ms');
          let waitMs = Math.min(2000 * Math.pow(2, attempt), 30_000);
          if (retryAfterMs) waitMs = Math.max(parseInt(retryAfterMs, 10) + 500, waitMs);
          console.log(`[${feature}] OpenAI ${res.status}, retrying in ${(waitMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
      }

      const data = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      const text = data.choices?.[0]?.message?.content?.trim() || '';
      const promptTokens = data.usage?.prompt_tokens || 0;
      const completionTokens = data.usage?.completion_tokens || 0;
      const totalTokens = data.usage?.total_tokens || 0;

      // Track usage
      const durationMs = Date.now() - callStartMs;
      logTokenUsage({ promptTokens, completionTokens, totalTokens, model, feature, workspaceId, durationMs });

      return { text, promptTokens, completionTokens, totalTokens };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError' && attempt < maxRetries) {
        console.log(`[${feature}] OpenAI timeout, retrying (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (attempt === maxRetries) throw err;
      // Generic retry for network errors
      console.log(`[${feature}] OpenAI error: ${err instanceof Error ? err.message : err}, retrying (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
  throw new Error(`[${feature}] OpenAI call failed after ${maxRetries} retries`);
}

// --- Time Saved Estimation ---

/** Estimated human-equivalent minutes per AI feature operation */
const HUMAN_MINUTES_PER_OP: Record<string, number> = {
  'content-brief': 150,       // 2.5 hours of research & writing
  'keyword-strategy': 240,    // 4 hours of keyword research
  'schema-generation': 60,    // 1 hour of schema markup
  'cms-schema-template': 45,  // 45 min CMS template setup
  'seo-audit-recs': 30,       // 30 min analyzing audit results
  'seo-rewrite': 15,          // 15 min per title/meta rewrite
  'seo-bulk-fix': 10,         // 10 min per bulk fix item
  'keyword-analysis': 20,     // 20 min keyword research
  'internal-links': 30,       // 30 min finding link opportunities
  'content-score': 20,        // 20 min content analysis
  'search-chat': 10,          // 10 min answering a data question
  'client-search-chat': 10,   // 10 min client question
  'alt-text': 5,              // 5 min per image alt text
};
const DEFAULT_HUMAN_MINUTES = 10;

export function getTimeSaved(workspaceId?: string, since?: string): {
  totalMinutesSaved: number;
  totalHoursSaved: number;
  operationCount: number;
  byFeature: Record<string, { count: number; minutesSaved: number }>;
} {
  let entries = usageLog;
  if (workspaceId) entries = entries.filter(e => e.workspaceId === workspaceId);
  if (since) entries = entries.filter(e => e.timestamp >= since);

  const byFeature: Record<string, { count: number; minutesSaved: number }> = {};
  let totalMinutesSaved = 0;

  for (const e of entries) {
    const humanMin = HUMAN_MINUTES_PER_OP[e.feature] || DEFAULT_HUMAN_MINUTES;
    if (!byFeature[e.feature]) byFeature[e.feature] = { count: 0, minutesSaved: 0 };
    byFeature[e.feature].count++;
    byFeature[e.feature].minutesSaved += humanMin;
    totalMinutesSaved += humanMin;
  }

  return {
    totalMinutesSaved,
    totalHoursSaved: Math.round((totalMinutesSaved / 60) * 10) / 10,
    operationCount: entries.length,
    byFeature,
  };
}

/**
 * Parse JSON from an AI response, stripping markdown fences if present.
 */
export function parseAIJson<T = Record<string, unknown>>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}
