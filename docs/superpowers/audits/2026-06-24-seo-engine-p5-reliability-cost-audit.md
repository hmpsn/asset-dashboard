I'll synthesize the pre-plan audit from the 5 scan results. The scans already contain the file:line precision I need, so I'll produce the structured document directly.

# Pre-Plan Audit — SEO Decision Engine P5 (Reliability + Cost Governance)

P5 has **no feature flag** (reliability/cost infrastructure). Acceptance: transient errors retry then succeed/record-failed (never silent empty); breaker trips once + short-circuits; per-workspace credit aggregation is queryable; budget gate is enforced.

---

## 1. Surface inventory

### Surface A — HTTP retry/backoff layer
**Current state:** Zero retry/backoff anywhere in the fetch layer. `fetchExternal` throws `ExternalFetchError` on any non-2xx (429/5xx treated identically to 400/401/402) or network error; the throw propagates up to `runDataForSeoOperation`, which converts it to `[]`/`null` via `handleError`. A transient 429 silently becomes an empty result with no retry.
**Files:lines to touch:**
- `server/external-fetch.ts:398–457` — `fetchExternal()` (add retry loop + retryable-status classification)
- `server/external-fetch.ts:489–497` — `fetchProviderJson()` (entry point; retry config plumbed here)
- `server/providers/dataforseo-provider.ts:279–368` (`apiCall`), `370–450` (`apiGet`) — error flow consumers (no change needed, but must remain transparent)
- `server/providers/dataforseo-provider.ts:488–541` — `runDataForSeoOperation()` (cache write at 533, credit-exhaustion check; verify retry transparency to flag-OFF cache keys)

### Surface B — Circuit-breaker (`markCapabilityDisabled`)
**Current state:** `markCapabilityDisabled` is defined and exported but **never called in production**. Subscription errors (40204) are detected by `isSubscriptionError()` in the backlinks handlers but degrade silently to `null`/`[]` without tripping the breaker, so every request re-hits the paid API. `getProviderForCapability` explicitly excludes `'backlinks'` from the disabled-check (`capability !== 'backlinks'` guard).
**Files:lines to touch:**
- `server/providers/dataforseo-provider.ts:1631` (getBacklinksOverview subscription branch), `1675` (getReferringDomains subscription branch) — add `markCapabilityDisabled('dataforseo','backlinks', ttl)` call
- `server/seo-data-provider.ts:231` — remove `capability !== 'backlinks'` guard so backlinks is checked
- `server/seo-data-provider.ts:175–201` — registry + `markCapabilityDisabled`/`isCapabilityDisabled` (reference; TTL persistence decision lands here)
- Consumers that must degrade cleanly once tripped: `server/routes/backlinks.ts:18–32`, `server/routes/seo-provider.ts:79–116`, `server/intelligence/seo-context-slice.ts:319–328`

### Surface C — Credit usage read/aggregation + `assertCreditBudget`
**Current state:** Full write+read pipeline exists. `logCreditUsage()` (139–144) buffers to daily JSON in `data/dataforseo-usage/`; `getDataForSeoUsage()` (1683–1698) and `getDataForSeoByDay()` (1700–1729) aggregate on demand. **`assertCreditBudget` does not exist** (zero grep hits). `Workspace.tier` exists but is never consulted on API calls. The proven tier-gate pattern is `usage-tracking.ts` (`LIMITS` + `incrementIfAllowed` + `atomicIncrementTxn`).
**Files:lines to touch:**
- **New:** `server/credit-budget-gate.ts` (`assertCreditBudget` + `CREDIT_BUDGETS` config)
- `server/providers/dataforseo-provider.ts:488–541` — call gate inside `runDataForSeoOperation` (after cache check, before `apiCall` at 517)
- `server/workspaces.ts:computeEffectiveTier()` — use for trial-adjusted tier (not raw `ws.tier`)
- Pattern references: `server/usage-tracking.ts:25–50` (LIMITS), `141–150` (incrementIfAllowed), `server/routes/voice-calibration.ts:177` (429 shape)

### Surface D — Partial UI wiring (dark data + budget UX)
**Current state:** `GET /api/ai/usage` (`server/routes/ai.ts:118–129`) already returns `dataforseo` + `dataforseoDaily`, but `AIUsageSection` (`AIUsageSection.tsx:28–33`) omits both from its interface — **served but never rendered**. DataForSEO health card hardcodes `quotaStatus: 'unknown'` (`health.ts:250–265`). Zero occurrences of any "budget exceeded/blocked" string in `src/`.
**Files:lines to touch:**
- `src/components/AIUsageSection.tsx:28–33` (extend `AIUsageData`), `:40` (already fetches) — render `dataforseo`/`dataforseoDaily`
- `server/routes/health.ts:250–265` (esp. 258–261) — compute real `quotaStatus`/`quotaDetail` from budget vs usage
- `src/components/settings/ConnectionsTab.tsx:81–86, 294, 307–309` — already consumes `quotaStatus`/`quotaDetail` (auto-colors once status is real; no change)
- `src/components/NotificationBell.tsx:36–87, :52` + `shared/types/background-jobs.ts:52–64` — surface budget-blocked via `job.message`

### Surface E — Test surface
**Current state:** External-fetch error classification is tested (`tests/unit/external-fetch.test.ts:21–148`); provider degradation to `[]`/null is tested (`dataforseo-provider.test.ts:795–812, 840–851`); credit-exhaustion cooldown (`CREDIT_COOLDOWN_MS`) exists (`dataforseo-provider.ts:162–171`). **Gaps:** no retry-then-failed (FM-2) test, no breaker-trips-once short-circuit test, no credit-aggregation-queryability test, no budget-gate-enforced test, no budget→NotificationBell path test.
**Files:lines to touch (new test files):**
- `tests/unit/external-fetch-retry-exhaustion.test.ts`, `tests/unit/dataforseo-provider-credit-aggregation.test.ts`, `tests/unit/credit-budget-gate.test.ts`, `tests/unit/dataforseo-capability-breaker.test.ts`, `tests/integration/background-job-budget-notification.test.ts`
- Reuse: `mockFetchOnce`/`fetchSpy` patterns from `dataforseo-provider.test.ts`, `seedWorkspace` fixture, FM-2 pattern from `tests/unit/intelligence-recompute-job.test.ts:105–116`

---

## 2. Implementation units

| Unit | Scope | Files (exclusive owner) | Depends on |
|------|-------|-------------------------|-----------|
| **U1 — Retry/backoff layer** | Add bounded retry-with-backoff for transient (429/503/504 + network) in fetch layer; permanent (400/401/402/403/404) throw immediately | `server/external-fetch.ts` | none |
| **U2 — Circuit-breaker wiring** | Call `markCapabilityDisabled('dataforseo','backlinks', ttl)` in both subscription branches; remove the `!== 'backlinks'` guard | `server/providers/dataforseo-provider.ts:1631/1675`, `server/seo-data-provider.ts:231` | none (independent of U1) |
| **U3 — Budget gate module** | New `server/credit-budget-gate.ts`: `assertCreditBudget` + `CREDIT_BUDGETS`, reads `getDataForSeoUsage` + `computeEffectiveTier` | **new** `server/credit-budget-gate.ts` | C read path (already exists) |
| **U4 — Gate integration** | Wire `assertCreditBudget` into `runDataForSeoOperation` (after cache, before network); catch in `handleError`→empty OR throw budget-blocked reason for jobs | `server/providers/dataforseo-provider.ts:488–541` | **U3** |
| **U5 — Health-card quota status** | Replace hardcoded `'unknown'`; map usage vs `CREDIT_BUDGETS` → `ok/warning/critical`; consumed/limit `quotaDetail` | `server/routes/health.ts:250–265` | **U3** (needs `CREDIT_BUDGETS`) |
| **U6 — AIUsageSection dark-data** | Extend `AIUsageData` to include `dataforseo`/`dataforseoDaily`; render card/chart | `src/components/AIUsageSection.tsx` | none (data already served) |
| **U7 — Budget-blocked NotificationBell** | Set `job.message` to user-readable budget-blocked text when a job's DataForSEO call is gate-blocked | `shared/types/background-jobs.ts` (if reason code added) + job executor + verify `NotificationBell.tsx:52` | **U4** (gate must throw a typed reason) |
| **U8 — Tests** | All 5 new test files | `tests/...` | U1–U7 (per-suite) |

**Dependency summary:** U1 and U2 are fully independent of everything else. U3 is the keystone — U4, U5, U7 all consume it. U6 is independent (closes a pure dark-data gap). U8 trails each unit.

---

## 3. Cross-phase contract (highest-leverage decision)

P6–P8 call `assertCreditBudget` at route entry points. Lock this signature now so downstream phases don't churn.

```typescript
// server/credit-budget-gate.ts

/** Per-tier monthly DataForSEO credit budgets. Premium = unlimited. */
export const CREDIT_BUDGETS: Record<'free' | 'growth' | 'premium', number> = {
  free: 0,            // no paid API access — pre-cache reads only
  growth: 1000,       // ~tunable; recommended default below
  premium: Infinity,
};

/** Thrown by assertCreditBudget. Carries a stable code for HTTP + job-message mapping. */
export class CreditBudgetError extends Error {
  readonly code = 'credit_budget_exceeded' as const;
  readonly tier: string;
  readonly endpoint: string;
  constructor(tier: string, endpoint: string, message: string) {
    super(message);
    this.name = 'CreditBudgetError';
    this.tier = tier;
    this.endpoint = endpoint;
  }
}

/**
 * Throws CreditBudgetError if the workspace's effective tier has no budget,
 * or month-to-date credits already meet/exceed the tier budget.
 * Caller resolves tier via computeEffectiveTier() — do NOT pass raw ws.tier.
 * Cached reads bypass this gate (they are 0-cost); gate only guards network calls.
 */
export function assertCreditBudget(
  workspaceId: string,
  tier: 'free' | 'growth' | 'premium',
  endpoint: string,
): void;
```

**Throw/return contract (the part P6–P8 must rely on):**
- **Throws `CreditBudgetError`** (never returns a value) — symmetric with `usage-tracking.ts` semantics but as a typed throw so jobs can branch on `err.code === 'credit_budget_exceeded'`.
- **Route handlers** catch and return `res.status(429).json({ error: 'Monthly credit budget reached for your tier', code: 'credit_budget_exceeded' })` — mirrors `voice-calibration.ts:177`.
- **`runDataForSeoOperation` (U4)** catches in `handleError` → returns `emptyValue` for fire-and-forget reads, OR rethrows for job contexts so U7 can set `job.message`. Decide per-caller via an option flag, default = degrade-to-empty.
- **Cached reads are exempt** — gate is called only on the network-call path (after the cache check at line ~501), so a budget-exhausted workspace still serves cached data. This is correct but a documented UX nuance.

**Why this is the keystone:** five units and three future phases reference this exact shape. A `void`-throwing function with a typed error code lets routes return 429, jobs set messages, and the health card read `CREDIT_BUDGETS` — all from one contract. Picking "throw vs boolean return" wrong forces a refactor across P6–P8.

---

## 4. Dark-output checks

**Gap 1 — served-but-unsurfaced `dataforseo`/`dataforseoDaily`.** Confirmed: `server/routes/ai.ts:126–128` populates both fields in the `/api/ai/usage` response; `AIUsageSection.tsx:28–33` omits them from `AIUsageData` and never renders them. This is dead server work today.
**Closed by U6:** extend the `AIUsageData` interface with `dataforseo?: { totalCredits; totalCalls; cachedCalls }` and `dataforseoDaily?: Array<{ date; credits; calls; cachedCalls }>`, then add a DataForSEO credit card + daily trend row. No backend change required — the data is already on the wire.

**Gap 2 — budget-blocked UX.** Confirmed: zero "budget exceeded/blocked" strings in `src/`; `health.ts:258` hardcodes `quotaStatus: 'unknown'` so the DataForSEO badge always maps to blue ("unknown") via `quotaBadgeTone()`; NotificationBell has no budget reason path.
**Closed by U5 + U7:** U5 computes real `quotaStatus` (`ok`/`warning`/`critical`) from MTD usage vs `CREDIT_BUDGETS`, which makes `ConnectionsTab.tsx:294/307–309` light up correctly with no component change. U7 maps `CreditBudgetError` → `job.message` ("DataForSEO budget reached — upgrade to continue") so `NotificationBell.tsx:52` renders it with no frontend change.

---

## 5. Test plan

| Test | File | Assertion | Mocks/fixtures |
|------|------|-----------|----------------|
| **Retry-then-succeeds** | `tests/unit/external-fetch-retry-exhaustion.test.ts` | 429 on attempt 1–2, 200 on 3 → resolves with body; result logged with credits | `mockFetchOnce` sequence, `fetchSpy` |
| **Retry-exhausted records failed (FM-2)** | same | 429 on all attempts → throws `ExternalFetchError` (NOT silent `[]`); job path records `status='error'` | FM-2 pattern from `intelligence-recompute-job.test.ts:105–116` |
| **Permanent error not retried** | same | 402/400 on attempt 1 → immediate throw; `fetchSpy` called exactly once; 402 still marks credit-exhaustion | `fetchSpy` call-count |
| **Breaker trips once + short-circuits** | `tests/unit/dataforseo-capability-breaker.test.ts` | 40204 on first backlinks call → `markCapabilityDisabled` set; second call short-circuits, `fetchSpy` NOT called again; `getBacklinksProvider()` returns null | `isSubscriptionError` mock, `fetchSpy` |
| **Breaker TTL expiry** | same | set expiresAt in past → `isCapabilityDisabled` returns false, re-enables | clock control |
| **Credit aggregation queryable** | `tests/unit/dataforseo-provider-credit-aggregation.test.ts` | 3 calls (0.001/0.002/0.003) → `getDataForSeoByDay` daily bucket sums 0.006; per-workspace total + calls/cachedCalls correct | seeded usage entries |
| **Cached hit logs 0 credits** | same | cache hit → `logCreditUsage({ credits: 0, cached: true })` | cache pre-seed |
| **Budget gate enforced** | `tests/unit/credit-budget-gate.test.ts` | usage ≥ tier budget → throws `CreditBudgetError`; free tier → throws immediately; premium → never throws; trial elevates free→growth | mock `getDataForSeoUsage`, `computeEffectiveTier` |
| **Budget→NotificationBell** | `tests/integration/background-job-budget-notification.test.ts` | gate-blocked job → `updateJob(status='error', message=...)`; message contains budget text; FM-2 guard blocks false auto-resolve | `seedWorkspace`, mock `broadcastToWorkspace` |

**New pr-check rule (recommended):** "silent-empty degradation must record failed status" — grep `catch.*return \[\]` in provider files, exclude legitimate discovery endpoints. Prevents regression of the FM-2 acceptance criterion.

---

## 6. Risks + open decisions

**Owner-call questions (with recommended defaults):**

1. **Credit budget per tier?** — Spec doesn't fix numbers.
   *Recommended default:* `free: 0`, `growth: 1000`, `premium: Infinity`, defined in `CREDIT_BUDGETS` and tunable in one place. Flag for owner sign-off before P6 ships, since enabling it retroactively blocks free/growth workspaces already calling the API (support risk — consider a grace window).

2. **In-memory vs persisted breaker?** — Registry is in-memory; a server restart forgets a 24h subscription block and re-hits the paid API every restart.
   *Recommended default:* keep in-memory for P5 (matches existing `disabledCapabilities` Map) but set a **TTL** (e.g. 6h) via `markCapabilityDisabled('dataforseo','backlinks', 6*60*60*1000)` rather than permanent, so it self-recovers. Persisted breaker → defer to a follow-up.

3. **Does retry apply to a future Semrush provider?** — Only DataForSEO exists today; `semrush-provider.ts` is absent.
   *Recommended default:* place retry in `fetchExternal`/`fetchProviderJson` (shared layer) so any future provider inherits it automatically. Forbid provider-specific `fetchProviderJson` overrides.

4. **Cost-estimation timing for the gate** — `assertCreditBudget` runs before the call and can't know actual `task.cost`; budget is checked against MTD totals, so a single call can overshoot by one call's cost.
   *Recommended default:* gate on cumulative MTD ≥ budget (one-call overshoot tolerated). Conservative per-endpoint pre-estimation is over-engineering for P5; revisit only if overshoot proves material.

**Non-decision risks to hold during build:**
- Retry must not exceed the 20s `fetchProviderJson` timeout or mis-attribute a mid-retry 402 — credit-exhaustion marking must reflect the **final** attempt.
- Retry placement must stay invisible to flag-OFF cache-key construction (`database` geo-token byte-identity at `dataforseo-provider.ts:106–108`).
- `isSubscriptionError` relies on error-message text — retry wrapping must preserve the original message across attempts.
- TOCTOU on the budget gate — two concurrent calls can both pass before either is logged; acceptable for a soft cost-governance gate, but note it (the disk-buffer write path is not transactional like `atomicIncrementTxn`).

---

## 7. Parallelization

**Wave 1 (fully concurrent — no shared files, no dependencies):**
- **U1** — Retry layer (`external-fetch.ts`)
- **U2** — Breaker wiring (`dataforseo-provider.ts` backlinks branches + `seo-data-provider.ts:231`)
- **U3** — Budget gate module (new `credit-budget-gate.ts`)
- **U6** — AIUsageSection dark-data (`AIUsageSection.tsx`) — independent, data already served

> **File-ownership note:** U2 and U4 both touch `dataforseo-provider.ts`, so they **cannot** run concurrently. Put U2 in Wave 1 and U4 in Wave 2 (different line regions: U2 at 1631/1675, U4 at 488–541) but sequence them to avoid index contention in a shared checkout.

**Wave 2 (after U3 lands — all consume `CREDIT_BUDGETS`/`assertCreditBudget`):**
- **U4** — Gate integration into `runDataForSeoOperation` (sequence after U2 — same file)
- **U5** — Health-card quota status (`health.ts`)
- **U7** — NotificationBell budget-blocked (depends on U4's typed throw)

**Wave 3:**
- **U8** — Tests per suite; the retry/aggregation/budget-gate/breaker unit tests can be written in parallel with their respective units (TDD), but the integration test (U7 path) and the FM-2 retry test must wait for U4/U1 to land.

**Critical path:** U3 → U4 → U7. Everything else parallelizes around it.