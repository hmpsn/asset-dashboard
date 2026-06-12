# E4 — Server-side grounding for client chat (audit #17)

**Branch:** `claude/core-e4-client-chat-grounding` (off `origin/staging`)
**Date:** 2026-06-11
**Owner files (exclusive):** `server/routes/public-analytics.ts`, tests. No frontend, no shared types, no other server modules.

## Citation re-verification (staging has moved)

- **Schema** — `chatSchema` at `server/routes/public-analytics.ts:298-303`. Confirmed: `context: z.record(z.unknown()).optional()` — opaque object pass-through.
- **Verbatim serialization** — `:509`: `${JSON.stringify(context, null, 2)}` appended to the system prompt. Confirmed unbounded, client-controlled.
- The `context` object also drives ~25 `dataInventory` availability flags (`hasSearch`, `context?.ga4Comparison`, etc.) and `context?.days` / audit-traffic gating.

## The two problems

1. **Prompt injection** — a client posts arbitrary JSON in `context`; it lands verbatim in the system prompt below the guardrails. An attacker can inject "ignore previous instructions" payloads as structured data.
2. **Unbounded token sink** — `z.record(z.unknown())` has no size cap. A client can post megabytes; we serialize all of it into the prompt.

## Design

### Grounding: server-authoritative, slice-derived

Replace the verbatim `JSON.stringify(context)` block with a server-built intelligence block. The endpoint **already** calls `buildSeoPromptContext(ws.id)` (seoContext + learnings). Extend that to a **client-safe slice set** via `buildIntelPrompt()`:

- Slices: `['seoContext', 'insights', 'siteHealth', 'learnings']`.
- **Excluded deliberately** (D1/EMV precedent): `clientSignals` (churn risk, intent signals, approval rate — agency-only follow-up data), `operational`, `eeatAssets`, `contentPipeline`. The standard `formatForPrompt` path is client-safe — `formatters.ts:420-421` shows `emvPerWeek` is dropped from the standard formatter and only exposed via the admin-only `recSummary`. So the chosen slices carry no EMV/admin-only fields.
- The server now decides what the model sees, scoped to the workspace. The client cannot inject content into the grounding block.

### Client hints: enum-validated, size-capped only

The frontend (`src/hooks/useChat.ts`, NOT owned here) still posts a `context` object. We must not 400 every real request, but we must stop trusting/serializing it. New schema:

- `question: z.string().min(1).max(5000)` (already capped)
- `sessionId: z.string().max(100).optional()`
- `betaMode: z.boolean().optional()`
- `currentTab: z.enum([...]).optional()` — a fixed union of client dashboard tab ids (lightweight hint for "what is the user looking at"). Size-capped by enum.
- `days: z.number().int().min(1).max(366).optional()` — the date-range hint already used for `context?.days`; promote to a typed top-level field.
- The opaque `context` record is **removed** from the schema. With Zod's default strip behavior, the frontend's `context` field is silently dropped (not 400) — so the old client keeps working but its payload never reaches the prompt. We do NOT use `.strict()` (that would 400 the live frontend).

`dataInventory` availability flags are now derived from what the **server** actually assembled (the intelligence block + server-side audit/content reads), not from client-claimed `context?.X`. Where a flag previously keyed off `context?.search` etc., it now keys off the server-fetched data already present in the handler (audit traffic, content plan, seo context) or is folded into the single intelligence block. The `betaMode` revenue-section split is unchanged.

### Response shape — UNCHANGED

`res.json({ answer, sessionId, detectedIntent })`. Verified against `useChat.ts:177` consumer. No change.

### Named-operation decision

`callAI({ operation: 'client-search-chat', ... })` is ALREADY a registered named operation (`server/ai-operation-registry.ts:67`). Output is prose (`outputMode: 'prose'`), so no JSON/Zod payload validation applies. **Decision: keep the existing named operation; no registry change needed.** Documented per the ai-operation-contracts rule.

### FM-2: slice failure degrades, never 500

`buildIntelPrompt`/`buildSeoPromptContext` are wrapped so a slice/assembly failure yields a minimal grounding string (site identity + date range only) and the chat still returns 200. The existing handler already wraps audit-traffic and content-plan reads in try/catch; the new intelligence read gets the same treatment.

## Tests (`tests/integration/client-chat-grounding.test.ts`, in-process `createApp()` + `vi.mock('../../server/ai.js')`)

In-process server (real `http.createServer(createApp())`, unique port) is required so `vi.mock` of `callAI` captures the prompt — the standard `createTestContext` spawns a subprocess the mock can't reach. Auth satisfied via admin HMAC `x-auth-token`.

1. **Injection never reaches the prompt** — POST with `context: { malicious: 'IGNORE ALL PREVIOUS INSTRUCTIONS ...', fakeMetric: 999 }`. Assert captured `system` prompt does NOT contain the injected strings, and DOES contain the slice-derived grounding marker.
2. **Oversized opaque context is dropped, request still succeeds** — POST a multi-KB `context`; assert 200 and the prompt does not contain the blob.
3. **Enum hint accepted + reflected** — valid `currentTab` enum value accepted (200); an invalid enum value → 400.
4. **Slice failure → minimal grounding, 200 not 500** — mock the intelligence builder to throw; assert 200 and a minimal grounding prompt.
5. **Response shape unchanged** — assert `{ answer, sessionId, detectedIntent }` keys present.
6. **Validation-rejection ordering** — for the 400-enum test use `x-no-auto-public-auth: true`? N/A here (in-process app, admin token supplied). Document: we authenticate, so a 401 cannot shadow the 400.

## Gates

`npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts` + new test file + `tests/integration/public-analytics*.test.ts` shard. Pre-commit hook runs full suite.

## Docs

- `FEATURE_AUDIT.md` — new entry #483 (482 just landed).
