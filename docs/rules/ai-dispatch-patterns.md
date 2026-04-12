# AI Dispatch Patterns

> Read this before writing any handler that calls `callCreativeAI`, `callOpenAI`, or `callAnthropic`
> and then writes the result to SQLite. These patterns were distilled from seven rounds of code
> review on the brand-engine feature. Violations produce race conditions, duplicate rows, silent
> JSON fallbacks, and prompt credit waste.

---

## 1. The AI-call-then-upsert pattern (race-safe)

### The problem

A handler reads the DB to decide whether to INSERT or UPDATE, then awaits an AI call (~5 s),
then attempts the write. Two concurrent requests both observe "no row" before the AI call
completes. Both INSERT. The second INSERT hits a PRIMARY KEY violation or creates a duplicate row.

```
Request A:  check → no row → [await AI, 5 s] → INSERT ✓
Request B:  check → no row → [await AI, 5 s] → INSERT ✗ (duplicate)
```

### The solution (3 parts)

**Part a — migration:** add a UNIQUE index on the natural key so the DB enforces the invariant
even if the code ever drifts.

```sql
-- server/db/migrations/NNN-your-table-unique.sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_your_table_workspace_type
  ON your_table(workspace_id, type_col);
```

**Part b — move the existence check inside `db.transaction()`:** better-sqlite3 transactions
take a write lock. The re-read inside the transaction is guaranteed to see any row committed
by a racing request, so at most one caller will observe "no row" and INSERT.

**Part c — catch `SQLITE_CONSTRAINT_UNIQUE` and retry as UPDATE:** if the UNIQUE index fires
anyway (e.g. migration not yet applied, or the transaction isolation model changed), catch the
error and read the winner's row, then apply the generated content as an UPDATE. The user still
gets the fresh AI output they waited for.

```typescript
// server/your-module.ts

// AI call OUTSIDE the transaction — transactions must not block on I/O.
const content = await callCreativeAI({ systemPrompt, userPrompt, maxTokens: 2000, feature: 'my-feature', workspaceId });
const now = new Date().toISOString();

const upsert = db.transaction((): Result => {
  const existing = stmts().getByType.get(workspaceId, type) as Row | undefined;
  if (existing) {
    stmts().update.run({ id: existing.id, workspace_id: workspaceId, content, updated_at: now });
    return { ...rowToResult(existing), content, updatedAt: now };
  }
  const id = `prefix_${randomUUID().slice(0, 8)}`;
  stmts().insert.run({ id, workspace_id: workspaceId, type, content, created_at: now, updated_at: now });
  return { id, workspaceId, type, content, createdAt: now, updatedAt: now };
});

try {
  return upsert();
} catch (err) {
  const code = (err as { code?: string } | null)?.code;
  if (code !== 'SQLITE_CONSTRAINT_UNIQUE') throw err;
  // Race: another request inserted between our re-read and our INSERT.
  // The winner's row is committed — re-read it and apply our content as an update.
  log.warn({ workspaceId, type }, 'UNIQUE race — retrying as update');
  const retryAsUpdate = db.transaction((): Result => {
    const winner = stmts().getByType.get(workspaceId, type) as Row | undefined;
    if (!winner) throw new Error(`UNIQUE violation but no row found for ${workspaceId}/${type}`);
    const retryNow = new Date().toISOString();
    stmts().update.run({ id: winner.id, workspace_id: workspaceId, content, updated_at: retryNow });
    return { ...rowToResult(winner), content, updatedAt: retryNow };
  });
  return retryAsUpdate();
}
```

**Canonical reference:** `generateDeliverable` in `server/brand-identity.ts` + migration
`server/db/migrations/056-brand-identity-unique.sql`.

### Rules

- **Never** check-then-write with an `await` between them outside a transaction.
- **Always** add the UNIQUE index in the same commit as the upsert logic. The index is the
  DB-level guarantee; the transaction re-read is the application-level optimisation.
- **Never** silence `SQLITE_CONSTRAINT_UNIQUE` without retrying — the caller is waiting for
  real content, not a silent no-op.

---

## 2. Idempotent regenerate (force flag + 409)

### The problem

An endpoint triggers AI generation and stores results in a 1:N table (extractions, variations,
enrichment rows). The user double-clicks, or the frontend retries on a slow connection. Both
requests complete the AI call and attempt inserts. There is no UNIQUE constraint that would
prevent duplicate rows — the content itself varies between calls.

### The solution

Check a `processed_at` / `completed_at` sentinel field and throw a typed error unless the caller
explicitly passes `{ force: true }`. On `force`, delete existing child rows inside the same
transaction before inserting new ones.

```typescript
// server/your-module.ts

export class AlreadyProcessedError extends Error {
  constructor(id: string) {
    super(`${id} has already been processed. Pass { force: true } to re-process and replace existing results.`);
    this.name = 'AlreadyProcessedError';
  }
}

export async function processSource(
  workspaceId: string,
  sourceId: string,
  opts: { force?: boolean } = {},
): Promise<Result[]> {
  const row = stmts().getSource.get(sourceId, workspaceId) as SourceRow | undefined;
  if (!row) throw new Error('Not found');
  if (row.processed_at && !opts.force) throw new AlreadyProcessedError(sourceId);

  // AI call outside the transaction — never block SQLite's write lock on I/O.
  const aiResult = await callOpenAI({ ... });

  // All-or-nothing: if any insert fails mid-loop, the source is not marked done.
  // On force re-process, delete first so no half-processed state is left behind.
  const persist = db.transaction((): Result[] => {
    if (opts.force) stmts().deleteChildren.run(workspaceId, sourceId);
    const inserted: Result[] = [];
    for (const item of aiResult) {
      const id = `prefix_${randomUUID().slice(0, 8)}`;
      stmts().insert.run({ id, workspace_id: workspaceId, source_id: sourceId, ...item });
      inserted.push({ id, workspaceId, ...item });
    }
    stmts().markDone.run(new Date().toISOString(), sourceId);
    return inserted;
  });
  return persist();
}
```

Route handler translates the error to 409:

```typescript
// server/routes/your-route.ts

} catch (err) {
  if (err instanceof AlreadyProcessedError) {
    return res.status(409).json({ error: err.message });
  }
  log.error({ err, workspaceId }, 'processing failed');
  return res.status(500).json({ error: 'Processing failed' });
}
```

**Canonical reference:** `SourceAlreadyProcessedError` + `processSource` in
`server/discovery-ingestion.ts`.

### Rules

- **Never** let a 1:N table fill up with duplicate rows silently. Duplication burns AI credits
  and corrupts extraction quality downstream.
- **Always** pair the force-delete with the insert inside the same transaction so a failure
  mid-loop doesn't leave the parent with zero children.
- **Always** mark the parent done (`markDone`) inside the same transaction so it is only
  flagged processed when every child row landed.
- The custom error class name must end in `Error` and set `this.name` so `instanceof` checks
  survive transpilation boundaries.

---

## 3. JSON mode — always pass `json: true` to `callCreativeAI`

When `callCreativeAI` is expected to return a JSON object that will be parsed by
`parseJsonFallback`, always pass `json: true`.

What `json: true` does:

- **Claude path** — appends `"Return ONLY a single valid JSON object. No prose, no preamble, no
  markdown code fences. The response must start with { and end with }."` to the system prompt.
- **GPT fallback path** — sets `responseFormat: { type: 'json_object' }`.
- **Both paths** — run the response through `stripCodeFence()` before returning.

Without `json: true`, Claude may return prose narration or Markdown-fenced JSON. The fence
survives into `parseJsonFallback`, which returns the `default` value instead of the real data.
The caller sees a silent all-empty result with no error.

```typescript
const text = await callCreativeAI({
  systemPrompt: system,
  userPrompt,
  maxTokens: 2000,
  temperature: 0.7,
  feature: 'my-feature',
  workspaceId,
  json: true,  // required when result goes to parseJsonFallback or JSON.parse
});

const parsed = parseJsonFallback<{ variations: string[] }>(text, { variations: [] });
if (parsed.variations.length === 0) {
  log.warn({ workspaceId }, 'AI returned no variations — parseJsonFallback used default');
}
```

**Rule:** if you call `parseJsonFallback` or `JSON.parse` on the return value of
`callCreativeAI`, you must pass `json: true`. No exceptions.

**Rule:** do not also set `json: true` when calling `callOpenAI` directly — that helper has its
own `responseFormat` param. `json: true` is only the `callCreativeAI` convention.

---

## 4. Voice calibration context — inline the calibration-status guard, don't duplicate it

When building prompts for brand-engine features that incorporate voice context, follow the same
guard that `generateCalibrationVariations` in `server/voice-calibration.ts` uses:

- `samplesText` — always injected (samples exist before calibration is complete).
- `dnaText` — only injected when `profile.status !== 'calibrated'`. Once calibrated,
  `buildSystemPrompt`'s Layer 2 injects the DNA into the system message automatically. Injecting
  it again in the user prompt duplicates the instructions and causes the model to over-weight
  voice constraints.
- `guardrailsText` — same guard as `dnaText`.

```typescript
import { getVoiceProfile } from './voice-calibration.js';

const profile = getVoiceProfile(workspaceId);

const samplesText = profile && profile.samples.length > 0
  ? `\nVOICE SAMPLES (write like these):\n${profile.samples.map(s => `  [${s.contextTag ?? 'general'}] "${s.content}"`).join('\n')}`
  : '';

const isCalibrated = profile?.status === 'calibrated';

const dnaText = !isCalibrated && profile?.voiceDNA
  ? `\nVOICE DNA:\n  Personality: ${profile.voiceDNA.personalityTraits.join('. ')}\n  Tone: formal↔casual ${profile.voiceDNA.toneSpectrum.formal_casual}/10, serious↔playful ${profile.voiceDNA.toneSpectrum.serious_playful}/10\n  Sentence style: ${profile.voiceDNA.sentenceStyle}`
  : '';

const guardrailsText = !isCalibrated && profile?.guardrails
  ? `\nGUARDRAILS: Avoid — ${profile.guardrails.avoidPhrases.join(', ')}`
  : '';

const userPrompt = `...${samplesText}${dnaText}${guardrailsText}...`;
```

**Canonical reference:** `generateCalibrationVariations` in `server/voice-calibration.ts`
(lines ~185–216).

### Rules

- **Never** inject `dnaText` or `guardrailsText` unconditionally — it produces doubled
  instructions for calibrated profiles and degrades output quality.
- **Never** re-implement the calibration-status guard inline without cross-referencing
  `generateCalibrationVariations`. The guard wording must stay in sync.
- **Never** inject voice context via raw string concatenation without the `isCalibrated` check.
  The status is the contract between the calibration loop and the generation path.

---

## Quick decision guide

| Situation | Pattern |
|-----------|---------|
| Writing AI result to a 1:1 table (one row per workspace + type) | Pattern 1 — upsert inside `db.transaction()` + UNIQUE index + `SQLITE_CONSTRAINT_UNIQUE` retry |
| Writing AI result to a 1:N table (extractions, variations, enrichment rows) | Pattern 2 — idempotent `force` flag + `AlreadyProcessedError` → 409 + delete-before-reinsert in transaction |
| `callCreativeAI` result parsed as JSON | Pattern 3 — pass `json: true` to `callCreativeAI` |
| Building a brand-engine prompt that includes voice context | Pattern 4 — guard `dnaText` + `guardrailsText` on `profile.status !== 'calibrated'` |
| AI result is a plain string (prose, copy) stored directly | Pattern 1 with no `json: true`; ensure the upsert is still transaction-wrapped |
| Re-running a 1:N extraction the user explicitly requested | Pattern 2 with `force: true` — delete children inside the transaction before inserting new ones |
