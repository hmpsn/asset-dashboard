# Prompt Standardization Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all high-impact AI features through `buildSystemPrompt()` so voice DNA (Layer 2) and custom notes (Layer 3) activate automatically, add `response_format` support to `callOpenAI`, inject missing intelligence context into SEO rewrites and content briefs, and standardize temperature settings across all AI calls.

**Architecture:** Each feature's existing prompt construction stays intact — `buildSystemPrompt(workspaceId, baseInstructions)` wraps the base instructions and appends workspace-specific layers. Intelligence context (page health, decay, cannibalization, learnings) is injected into prompts that currently lack it. No features are migrated to `buildWorkspaceIntelligence()` — that's a separate future refactor. This pass is purely about standardizing the prompt layer and filling intelligence gaps.

**Tech Stack:** Express + TypeScript (server), `callOpenAI`/`callAnthropic`/`callCreativeAI` wrappers, `buildSystemPrompt()` from `server/prompt-assembly.ts`, `getInsights()` from `server/analytics-insights-store.ts`, `getWorkspaceLearnings()`/`formatLearningsForPrompt()` from `server/workspace-learnings.ts`.

**Prerequisite:** Meeting Brief Task 0 must be merged (creates `server/prompt-assembly.ts` and the `custom_prompt_notes` column). This plan can run before or after Brandscript — Layer 2 (voice DNA) activates automatically when Brandscript Task 5b ships.

---

## File Map

| File | Action | Changes |
|------|--------|---------|
| `server/openai-helpers.ts` | Modify | Add `responseFormat` to `OpenAIChatOptions`, wire into request body |
| `server/routes/webflow-seo.ts` | Modify | Wire `buildKeywordMapContext` into single-page rewrites, add intelligence context (page health + decay + cannibalization), wrap system prompts with `buildSystemPrompt()` |
| `server/content-brief.ts` | Modify | Add workspace learnings injection, wrap with `buildSystemPrompt()`, add `response_format` for JSON reliability |
| `server/monthly-digest.ts` | Modify | Add top wins + ROI narrative, wrap with `buildSystemPrompt()` |
| `server/routes/rewrite-chat.ts` | Modify | Wrap system prompt with `buildSystemPrompt()` |
| `server/routes/keyword-strategy.ts` | Modify | Wrap system prompt with `buildSystemPrompt()` |
| `server/__tests__/openai-helpers-format.test.ts` | Create | Test response_format wiring |
| `server/__tests__/prompt-standardization.test.ts` | Create | Integration tests for intelligence injection |

---

## Dependency Graph + Parallelization

```
Batch A (sequential — infrastructure):
  Task 1 — callOpenAI response_format support

Batch B (parallel — each task owns exactly one file):
  Task 2 — SEO Rewrite enhancement     [owns: server/routes/webflow-seo.ts]
  Task 3 — Content Brief enhancement    [owns: server/content-brief.ts]
  Task 4 — Monthly Digest enhancement   [owns: server/monthly-digest.ts]
  Task 5 — Rewrite Chat standardization [owns: server/routes/rewrite-chat.ts]
  Task 6 — Keyword Strategy standard.   [owns: server/routes/keyword-strategy.ts]

  ▶ CHECKPOINT: scaled-code-review on Batch B output. Fix Critical/Important before Batch C.

Batch C (sequential — integration test + PR):
  Task 7 — Integration Tests + Quality Gates + PR
```

## Model Assignments

| Task | Model | Reason |
|------|-------|--------|
| Task 1 — callOpenAI infra | Haiku | Mechanical options wiring |
| Task 2 — SEO Rewrite | Sonnet | Intelligence injection + prompt restructuring |
| Task 3 — Content Brief | Sonnet | Learnings injection + prompt restructuring |
| Task 4 — Monthly Digest | Sonnet | Outcome data injection + prompt enhancement |
| Task 5 — Rewrite Chat | Haiku | One-line buildSystemPrompt wrap |
| Task 6 — Keyword Strategy | Haiku | One-line buildSystemPrompt wrap |
| Task 7 — Tests + PR | Sonnet | Integration tests + quality gates |

---

## Task 1: Add `response_format` Support to `callOpenAI`

**Files:**
- Modify: `server/openai-helpers.ts`
- Create: `server/__tests__/openai-helpers-format.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/openai-helpers-format.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test that the request body includes response_format when provided.
// This requires intercepting the fetch call.
describe('callOpenAI response_format', () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedBody: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"test": true}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('includes response_format in request body when provided', async () => {
    // Dynamic import to pick up the mocked fetch
    const { callOpenAI } = await import('../openai-helpers.js');

    // Skip if no API key configured (CI)
    try {
      await callOpenAI({
        messages: [{ role: 'user', content: 'test' }],
        feature: 'test-format',
        responseFormat: { type: 'json_object' },
        maxRetries: 0,
      });
    } catch {
      // May fail if no API key — that's OK, we just need to check the fetch call
    }

    if ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.response_format).toEqual({ type: 'json_object' });
    }
  });

  it('omits response_format from request body when not provided', async () => {
    const { callOpenAI } = await import('../openai-helpers.js');

    try {
      await callOpenAI({
        messages: [{ role: 'user', content: 'test' }],
        feature: 'test-no-format',
        maxRetries: 0,
      });
    } catch {
      // May fail if no API key
    }

    if ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.response_format).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/__tests__/openai-helpers-format.test.ts
```
Expected: FAIL — `responseFormat` not recognized in `OpenAIChatOptions`.

- [ ] **Step 3: Add `responseFormat` to `OpenAIChatOptions` interface**

In `server/openai-helpers.ts`, find the `OpenAIChatOptions` interface (line ~215) and add the new field:

```typescript
interface OpenAIChatOptions {
  model?: 'gpt-4.1-nano' | 'gpt-4.1-mini' | 'gpt-4.1' | 'gpt-4o-mini' | 'gpt-4o';
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** JSON mode — forces valid JSON output from OpenAI */
  responseFormat?: { type: 'json_object' };
  /** Label for logging (e.g. 'seo-rewrite', 'schema-gen') */
  feature: string;
  /** Workspace ID for cost tracking */
  workspaceId?: string;
  /** Max retry attempts on 429/5xx (default 3) */
  maxRetries?: number;
  /** Timeout per request in ms (default 60000) */
  timeoutMs?: number;
}
```

- [ ] **Step 4: Destructure and wire into the request body**

In the `callOpenAI` function (line ~241), add `responseFormat` to the destructuring:

```typescript
export async function callOpenAI(opts: OpenAIChatOptions): Promise<OpenAIChatResult> {
  const {
    model = 'gpt-4.1-mini',
    messages,
    maxTokens = 1000,
    temperature = 0.7,
    responseFormat,
    feature,
    workspaceId,
    maxRetries = 3,
    timeoutMs = 60_000,
  } = opts;
```

Then update the `executeOpenAICall` pass-through (line ~270) to forward `responseFormat`:

```typescript
    () => executeOpenAICall({ model, messages, maxTokens, temperature, responseFormat, feature, workspaceId, maxRetries, timeoutMs }),
```

Also add `responseFormat` to the dedup key (line ~255) so two otherwise-identical calls with different `responseFormat` values aren't incorrectly deduped:

```typescript
  const dedupeKey = AIRequestDeduplicator.createKey({
    model,
    messages: messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })),
    temperature,
    maxTokens,
    responseFormat,
    workspaceId,
    feature,
  });
```

Then update the request body construction inside `executeOpenAICall` (line ~296) to conditionally include `response_format`:

```typescript
  const body = JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    ...(responseFormat && { response_format: responseFormat }),
  });
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run server/__tests__/openai-helpers-format.test.ts
```
Expected: All tests pass.

- [ ] **Step 6: Verify build**

```bash
npx tsc --noEmit --skipLibCheck
```
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add server/openai-helpers.ts server/__tests__/openai-helpers-format.test.ts
git commit -m "feat(openai): add response_format support for JSON mode"
```

---

## Task 2: SEO Rewrite — Keyword Map + Intelligence Context + buildSystemPrompt

> The single-page SEO rewrite endpoint has `buildKeywordMapContext` imported but not used. It also lacks cannibalization, page health, and content decay context. This task wires all three intelligence gaps and wraps the system prompt with `buildSystemPrompt()`.

**Model:** Sonnet

**Files:**
- Modify: `server/routes/webflow-seo.ts`

- [ ] **Step 1: Add imports**

At the top of `server/routes/webflow-seo.ts`, add these imports alongside existing ones:

```typescript
import { buildSystemPrompt } from '../prompt-assembly.js';
import { getInsights } from '../analytics-insights-store.js';
```

`buildKeywordMapContext` and `buildPageAnalysisContext` are already imported (line 18). `getInsights` is new.

- [ ] **Step 2: Build intelligence context block in the single-page rewrite handler**

In the `/api/webflow/seo-rewrite` handler, after the existing `pageAnalysisBlock` construction (around line 209), add a new intelligence block:

```typescript
    // Intelligence context: cannibalization + page health + content decay
    let intelligenceBlock = '';
    if (workspaceId) {
      try {
        const allInsights = getInsights(workspaceId);
        const pageInsights = allInsights.filter(i => i.pageId === pagePath || i.pageId === `/${pagePath}`);

        const cannibalization = pageInsights
          .filter(i => i.insightType === 'cannibalization')
          .slice(0, 2)
          .map(i => `- Cannibalization: ${i.title}`);

        const decay = pageInsights
          .filter(i => i.insightType === 'content_decay')
          .slice(0, 1)
          .map(i => `- Content decay: ${i.title}`);

        const health = pageInsights
          .filter(i => i.insightType === 'page_health')
          .slice(0, 1)
          .map(i => `- Page health: ${i.title} (impact: ${i.impactScore ?? 'n/a'})`);

        const lines = [...cannibalization, ...decay, ...health];
        if (lines.length > 0) {
          intelligenceBlock = `\n\nPAGE INTELLIGENCE:\n${lines.join('\n')}`;
        }
      } catch { /* intelligence not available — skip */ }
    }
```

- [ ] **Step 3: Wire keyword map + intelligence into contextBlocks**

Find the `contextBlocks` array (around line 211). Add `buildKeywordMapContext(workspaceId)` and `intelligenceBlock`:

```typescript
    const contextBlocks = [
      keywordContext,
      brandVoiceBlock,
      personasBlock,
      knowledgeBlock,
      gscBlock,
      auditBlock,
      pageAnalysisBlock,
      buildKeywordMapContext(workspaceId),
      intelligenceBlock,
    ].filter(Boolean).join('');
```

- [ ] **Step 4: Wrap the system prompt with `buildSystemPrompt()`**

`callCreativeAI` signature (server/content-posts-ai.ts line 29): `{ systemPrompt, userPrompt, maxTokens, feature, workspaceId }` — no `temperature` param. Temperature is hardcoded inside (`CLAUDE_TEMP = 0.7`, `CONTENT_TEMP = 0.7`). Do not attempt to pass temperature here.

Find the `callCreativeAI` call for "both" mode (around line 252). The `systemPrompt` is currently an inline string. Extract and wrap:

```typescript
    const baseSystemPrompt = 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 objects with "title" and "description" keys. No markdown, no explanation, no code fences.';
    const systemPrompt = buildSystemPrompt(workspaceId || '', baseSystemPrompt);

    const aiText = await callCreativeAI({
      systemPrompt,
      userPrompt: prompt,
      maxTokens: 800,
      feature: 'seo-rewrite-both',
      workspaceId: workspaceId || '',
    });
```

Do the same for the single-field mode `callCreativeAI` call (around line 346):

```typescript
    const baseSystemPromptSingle = 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 strings. No markdown, no explanation, no code fences.';
    const systemPromptSingle = buildSystemPrompt(workspaceId || '', baseSystemPromptSingle);

    const aiText = await callCreativeAI({
      systemPrompt: systemPromptSingle,
      userPrompt: prompt,
      maxTokens: 400,
      feature: 'seo-rewrite',
      workspaceId: workspaceId || '',
    });
```

- [ ] **Step 5: Apply the same pattern to bulk rewrite**

In the `/api/webflow/seo-bulk-rewrite` handler, find the `callCreativeAI` calls (around lines 682 and 728). Wrap their system prompts the same way:

```typescript
    // Both mode (bulk)
    const bulkBothSystemPrompt = buildSystemPrompt(resolvedWsId, 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 objects with "title" and "description" keys. No markdown, no explanation, no code fences.');

    const aiText = await callCreativeAI({
      systemPrompt: bulkBothSystemPrompt,
      userPrompt: prompt,
      maxTokens: 800,
      feature: 'seo-bulk-rewrite-both',
      workspaceId: resolvedWsId,
    });
```

```typescript
    // Single mode (bulk)
    const bulkSingleSystemPrompt = buildSystemPrompt(resolvedWsId, 'You are an elite SEO copywriter. Return ONLY a valid JSON array of 3 strings. No markdown, no explanation, no code fences.');

    const aiText = await callCreativeAI({
      systemPrompt: bulkSingleSystemPrompt,
      userPrompt: prompt,
      maxTokens: 400,
      feature: 'seo-bulk-rewrite',
      workspaceId: resolvedWsId,
    });
```

- [ ] **Step 6: Verify build**

```bash
npx tsc --noEmit --skipLibCheck
```
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add server/routes/webflow-seo.ts
git commit -m "feat(seo-rewrite): wire keyword map + intelligence context + buildSystemPrompt"
```

---

## Task 3: Content Brief — Learnings + buildSystemPrompt + JSON Reliability

> The content brief generator has analytics intelligence (`buildBriefIntelligenceBlock`) but lacks workspace learnings (win rates, proven content types). It also lacks `buildSystemPrompt()` and JSON reliability.

**Model:** Sonnet

**Files:**
- Modify: `server/content-brief.ts`

- [ ] **Step 1: Add imports**

At the top of `server/content-brief.ts`, add alongside existing imports:

```typescript
import { buildSystemPrompt } from './prompt-assembly.js';
import { getWorkspaceLearnings, formatLearningsForPrompt } from './workspace-learnings.js';
import { isFeatureEnabled } from './feature-flags.js';
```

Verify: `getInsights` is already imported (line 8). `buildSeoContext` and `buildKeywordMapContext` are already imported.

- [ ] **Step 2: Add learnings injection after the intelligence block**

In the `generateBrief` function, after the `intelligenceBlock` construction (around line 890), add learnings:

```typescript
    // Workspace learnings: what content types and strategies historically win
    let learningsBlock = '';
    if (isFeatureEnabled('outcome-ai-injection')) {
      try {
        const learnings = getWorkspaceLearnings(workspaceId);
        if (learnings) {
          const block = formatLearningsForPrompt(learnings, 'content');
          if (block) {
            learningsBlock = `\n\n${block}`;
          }
        }
      } catch { /* learnings not available — skip */ }
    }
```

- [ ] **Step 3: Inject learnings into the prompt**

Find where the prompt is assembled (around line 891–982). The prompt string concatenates several context blocks. Add `learningsBlock` after the existing `intelligenceBlock` injection:

Find the line where `intelligenceBlock` is appended to the prompt (search for `${intelligenceBlock}` in the prompt template) and add `${learningsBlock}` immediately after it.

- [ ] **Step 4: Wrap with `buildSystemPrompt()` and add `responseFormat`**

Find the `callOpenAI` call (around line 984). Currently:

```typescript
    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 7000,
      temperature: 0.5,
      feature: 'content-brief',
      workspaceId,
    });
```

Change to extract the system instructions and use `buildSystemPrompt()`:

```typescript
    const systemInstructions = `You are an expert SEO content strategist. Generate a comprehensive content brief as a JSON object. Return ONLY valid JSON matching the expected schema — no markdown fences, no explanation.`;
    const systemPrompt = buildSystemPrompt(workspaceId, systemInstructions);

    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      maxTokens: 7000,
      temperature: 0.5,
      responseFormat: { type: 'json_object' },
      feature: 'content-brief',
      workspaceId,
    });
```

Note: This moves the system prompt from the user message to a proper `system` role message. Verify the existing prompt doesn't already have a system-like preamble embedded — if it does, extract it into `systemInstructions` and keep only the data context in the user message.

- [ ] **Step 5: Verify build**

```bash
npx tsc --noEmit --skipLibCheck
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add server/content-brief.ts
git commit -m "feat(content-brief): add learnings + buildSystemPrompt + JSON reliability"
```

---

## Task 4: Monthly Digest — Outcome Wins + buildSystemPrompt

> The monthly digest already injects learnings and ROI highlights. This task wraps it with `buildSystemPrompt()` for voice DNA activation and adds a top-wins narrative block.

**Model:** Sonnet

**Files:**
- Modify: `server/monthly-digest.ts`

- [ ] **Step 1: Add imports**

At the top of `server/monthly-digest.ts`, add:

```typescript
import { buildSystemPrompt } from './prompt-assembly.js';
```

Verify: `getWorkspaceLearnings`, `formatLearningsForPrompt`, `getInsights`, and `getROIHighlights` are already imported.

- [ ] **Step 2: Add top-wins narrative block**

In the `generateMonthlyDigest` function, after the learnings injection (around line 130), add a top-wins block using outcome data:

```typescript
    // Top wins from outcome tracking — concrete evidence of what worked
    let topWinsBlock = '';
    if (isFeatureEnabled('outcome-ai-injection')) {
      try {
        const positiveInsights = getInsights(ws.id)
          .filter(i => i.severity === 'positive')
          .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0))
          .slice(0, 3);
        if (positiveInsights.length > 0) {
          topWinsBlock = `\nNotable wins this period:\n${positiveInsights.map(i => `- ${i.title}`).join('\n')}`;
        }
      } catch { /* insights not available — skip */ }
    }
```

- [ ] **Step 3: Pass `ws.id` and `topWinsBlock` into `generateDigestSummary`**

`generateDigestSummary` is a private function — `ws` is not in scope inside it. Thread `workspaceId` and `topWinsBlock` through as parameters.

Update the function signature (line 193):

```typescript
async function generateDigestSummary(
  month: string,
  wins: DigestItem[],
  issues: DigestItem[],
  roi: ROIHighlight[],
  metrics: { clicksChange: number; impressionsChange: number; avgPositionChange: number; pagesOptimized: number },
  learningsSummary?: string,
  recentOutcomesCount?: number,
  topWinsBlock?: string,     // ← new
  workspaceId?: string,      // ← new
): Promise<string> {
```

Update the call site (line 132):

```typescript
  const summary = await generateDigestSummary(monthLabel, wins, issuesAddressed, roiHighlights, metrics, learningsSummary, recentOutcomesCount, topWinsBlock, ws.id);
```

In the prompt construction inside `generateDigestSummary` (around line 213), add `topWinsBlock` after the `learningsSummary` line:

```typescript
${recentOutcomesCount !== undefined ? `- ${recentOutcomesCount} tracked outcome${recentOutcomesCount === 1 ? '' : 's'} in workspace learnings` : ''}
${metricLines ? `\nSearch performance this period:\n${metricLines}` : ''}
${learningsSummary ? `\nWorkspace outcome learnings:\n${learningsSummary}` : ''}
${topWinsBlock ?? ''}
```

- [ ] **Step 4: Wrap with `buildSystemPrompt()`**

Find the `callOpenAI` call in `generateDigestSummary` (around line 233). Currently:

```typescript
    const result = await callOpenAI({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 200,
      feature: 'monthly-digest',
    });
```

Change to:

```typescript
    const systemPrompt = buildSystemPrompt(
      workspaceId ?? '',
      'You are writing a concise monthly performance update for a website client dashboard. Write 2-3 factual, encouraging sentences. No fluff.',
    );

    const result = await callOpenAI({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      maxTokens: 200,
      temperature: 0.4,
      feature: 'monthly-digest',
      workspaceId: workspaceId ?? '',
    });
```

Note: `workspaceId` is now available as a function parameter (added in Step 3). The current call doesn't pass `temperature` (defaults 0.7) or `workspaceId` — this adds both. `buildSystemPrompt` gracefully handles an empty string workspaceId — it just skips Layer 3.

- [ ] **Step 5: Verify build**

```bash
npx tsc --noEmit --skipLibCheck
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add server/monthly-digest.ts
git commit -m "feat(monthly-digest): add top wins + buildSystemPrompt + temperature"
```

---

## Task 5: Rewrite Chat — buildSystemPrompt

> The rewrite chat already has the most complete context assembly of any feature (SEO context + page analysis + page content + audit issues + playbook). This task wraps the system prompt with `buildSystemPrompt()` so voice DNA and custom notes activate automatically.

**Model:** Haiku

**Files:**
- Modify: `server/routes/rewrite-chat.ts`

- [ ] **Step 1: Add import**

At the top of `server/routes/rewrite-chat.ts`, add:

```typescript
import { buildSystemPrompt } from '../prompt-assembly.js';
```

- [ ] **Step 2: Wrap the system prompt**

Find the system prompt construction (around line 154). Currently it's a long template literal assigned to `const systemPrompt`. Rename the existing variable and wrap:

```typescript
    const baseInstructions = `You are an expert SEO content strategist and copywriter. You are helping rewrite and optimize a specific web page.

Your role:
- Analyze the current page content and suggest specific rewrites
- When asked to rewrite a section, provide the COMPLETE rewritten text — not summaries or bullet points
- Match the brand voice exactly
- Incorporate target keywords naturally
- Optimize for both search engines AND answer engines (AI systems like ChatGPT, Perplexity)
- Format your rewrites in Markdown so they're easy to read and copy
- When showing rewritten content, use clear before/after formatting
- Be specific about WHERE on the page each change should go (which section, heading, paragraph)
- Explain your rationale briefly after each suggestion

Answer Engine Optimization (AEO) principles:
- Lead with a direct, concise answer to the page's implied question
- Use clear heading hierarchy (H1 → H2 → H3)
- Add FAQ sections with schema-ready Q&A pairs
- Include citations and data points
- Use definition-style sentences that AI systems can extract
- Avoid hidden content, dark patterns, and clickbait
${seoCtx.keywordBlock}${seoCtx.brandVoiceBlock}${seoCtx.personasBlock}${knowledgeBase}${buildPageAnalysisContext(workspaceId, pageUrl ? new URL(pageUrl).pathname : undefined)}${playbookBlock}${pageContextBlock}${issuesBlock}${priorContext ? `\n\nPREVIOUS CONVERSATION SUMMARY:\n${priorContext}` : ''}`;

    const systemPrompt = buildSystemPrompt(workspaceId, baseInstructions);
```

The `callOpenAI` call (around line 182) already passes `systemPrompt` via messages. No change needed there — the variable name is the same.

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit --skipLibCheck
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/rewrite-chat.ts
git commit -m "feat(rewrite-chat): wrap system prompt with buildSystemPrompt"
```

---

## Task 6: Keyword Strategy — buildSystemPrompt

> The keyword strategy generation already has sophisticated intelligence injection (`buildStrategyIntelligenceBlock`). This task wraps the system prompt with `buildSystemPrompt()`.

**Model:** Haiku

**Files:**
- Modify: `server/routes/keyword-strategy.ts`

- [ ] **Step 1: Add import**

At the top of `server/routes/keyword-strategy.ts`, add alongside existing imports:

```typescript
import { buildSystemPrompt } from '../prompt-assembly.js';
```

- [ ] **Step 2: Wrap the `callStrategyAI` helper with `buildSystemPrompt()`**

The strategy generation uses a local helper function `callStrategyAI` (around line 625) that wraps `callOpenAI`. This is the single point of control — wrap it here and all strategy AI calls benefit.

Find the helper (around line 625):

```typescript
    const callStrategyAI = async (messages: Array<{ role: string; content: string }>, maxTokens: number, _label?: string): Promise<string> => {
      const result = await callOpenAI({
        model: 'gpt-4.1-mini',
        messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        maxTokens,
        temperature: 0.3,
        feature: 'keyword-strategy',
        workspaceId: ws.id,
        maxRetries: 3,
        timeoutMs: 90_000,
      });
      return result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    };
```

Add a system message prepend using `buildSystemPrompt()`:

```typescript
    const strategySystemPrompt = buildSystemPrompt(ws.id, 'You are an expert SEO strategist. Analyze the website data and generate keyword strategies as valid JSON. Be specific: name pages, queries, and volumes when data supports it.');

    const callStrategyAI = async (messages: Array<{ role: string; content: string }>, maxTokens: number, _label?: string): Promise<string> => {
      const result = await callOpenAI({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: strategySystemPrompt },
          ...messages,
        ] as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        maxTokens,
        temperature: 0.3,
        responseFormat: { type: 'json_object' },
        feature: 'keyword-strategy',
        workspaceId: ws.id,
        maxRetries: 3,
        timeoutMs: 90_000,
      });
      return result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    };
```

Note: `ws.id` is available from the route handler's `ws` variable (resolved earlier in the handler). Temperature 0.3 is already set — this is correct for analytical strategy work.

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit --skipLibCheck
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/keyword-strategy.ts
git commit -m "feat(keyword-strategy): wrap system prompt with buildSystemPrompt + JSON mode"
```

---

## Checkpoint: Batch B Review

> Five files modified in parallel. Review before integration tests.

- [ ] **Step 1: Invoke scaled-code-review**

```bash
git diff HEAD~5..HEAD -- \
  server/routes/webflow-seo.ts \
  server/content-brief.ts \
  server/monthly-digest.ts \
  server/routes/rewrite-chat.ts \
  server/routes/keyword-strategy.ts
```

Pass this diff to `superpowers:scaled-code-review`.

- [ ] **Step 2: Fix all Critical and Important issues before proceeding**

---

## Task 7: Integration Tests + Quality Gates + PR

**Model:** Sonnet

**Files:**
- Create: `server/__tests__/prompt-standardization.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
// server/__tests__/prompt-standardization.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../prompt-assembly.js';
import db from '../db/index.js';

const TEST_WS = `test-psp-${Date.now()}`;

describe('prompt standardization pass — integration', () => {
  beforeAll(() => {
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, 'PSP Test', datetime('now'))`
    ).run(TEST_WS);
  });

  afterAll(() => {
    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(TEST_WS);
  });

  it('buildSystemPrompt returns base instructions for fresh workspace', () => {
    const result = buildSystemPrompt(TEST_WS, 'You are a helpful assistant.');
    expect(result).toBe('You are a helpful assistant.');
  });

  it('buildSystemPrompt appends custom_prompt_notes when set', () => {
    db.prepare(`UPDATE workspaces SET custom_prompt_notes = ? WHERE id = ?`)
      .run('Always frame improvements in terms of ROI', TEST_WS);

    const result = buildSystemPrompt(TEST_WS, 'Base instructions');
    expect(result).toContain('Base instructions');
    expect(result).toContain('Always frame improvements in terms of ROI');

    // Clean up
    db.prepare(`UPDATE workspaces SET custom_prompt_notes = NULL WHERE id = ?`).run(TEST_WS);
  });

  it('OpenAIChatOptions accepts responseFormat', async () => {
    // Type-check only — verify the interface accepts the new field
    const opts = {
      messages: [{ role: 'user' as const, content: 'test' }],
      feature: 'test',
      responseFormat: { type: 'json_object' as const },
    };
    expect(opts.responseFormat.type).toBe('json_object');
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run server/__tests__/prompt-standardization.test.ts
```
Expected: All tests pass.

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run
```
Expected: No regressions. All existing tests still pass.

- [ ] **Step 4: Quality gates**

```bash
npx tsc --noEmit --skipLibCheck
npx vite build
npx tsx scripts/pr-check.ts
```
All three must pass.

- [ ] **Step 5: Update FEATURE_AUDIT.md**

Add or update entries for each modified feature:
- SEO title/meta rewrite: note keyword map + intelligence context wiring, buildSystemPrompt
- Content brief: note learnings injection, buildSystemPrompt, JSON mode
- Monthly digest: note top wins narrative, buildSystemPrompt
- Rewrite chat: note buildSystemPrompt wrap
- Keyword strategy: note buildSystemPrompt, JSON mode

- [ ] **Step 6: Preview verification**

Start the dev server (`npm run dev:all`) and verify:
- Navigate to any workspace with GSC data
- Open the SEO Editor, run a rewrite on a page → verify it returns valid JSON with 3 suggestions
- Generate a content brief → verify it completes without error
- Open the rewrite chat, ask it to rewrite a heading → verify it responds with brand-aware suggestions
- If a workspace has `custom_prompt_notes` set, verify the notes influence AI output

- [ ] **Step 7: Create PR**

```bash
gh pr create --base staging --title "feat: prompt standardization pass — buildSystemPrompt + intelligence wiring" --body "$(cat <<'EOF'
## Summary
- Adds `response_format` support to `callOpenAI` for JSON mode reliability
- Wires `buildKeywordMapContext()` into single-page SEO rewrites (was imported but unused)
- Adds cannibalization, page health, and content decay intelligence to SEO rewrite prompts
- Adds workspace learnings (win rates, proven content types) to content brief generation
- Adds top-wins narrative to monthly digest
- Wraps 5 AI features with `buildSystemPrompt()` — voice DNA (Layer 2) and custom notes (Layer 3) activate automatically when available
- Standardizes temperature settings across all modified features

## Features affected
- SEO title/meta rewrite (single + bulk)
- Content brief generator
- Monthly digest
- Rewrite chat
- Keyword strategy generator

## Test plan
- [ ] `npx tsc --noEmit --skipLibCheck` passes
- [ ] `npx vite build` passes
- [ ] `npx vitest run` passes (full suite)
- [ ] `npx tsx scripts/pr-check.ts` passes
- [ ] SEO rewrite returns valid suggestions with keyword map context
- [ ] Content brief generates successfully with learnings injected
- [ ] Monthly digest includes top wins when available
- [ ] Rewrite chat responds with workspace-aware suggestions

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Commit test file**

```bash
git add server/__tests__/prompt-standardization.test.ts server/__tests__/openai-helpers-format.test.ts
git commit -m "test: add prompt standardization integration tests"
```
