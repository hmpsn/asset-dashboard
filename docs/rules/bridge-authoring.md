# Bridge Authoring Rules

Insight bridges (functions registered in `server/bridge-infrastructure.ts` that react to upstream events and upsert/resolve insights) are a recurring source of subtle bugs. Every bridge callback must follow the four rules below. Violations produce stale-cleanup bugs, double-broadcast flicker, admin-resolution clobbering, and silently-rewritten score fields.

## Rule 1 — Stale-cleanup immunity

**Pass `bridgeSource: '<bridge_flag>'` to every `upsertInsight()` call inside a bridge callback.**

When creating a new bridge insight, pass the literal bridge flag string. When re-upserting an existing insight (for example, to adjust its score in response to a new event), pass `bridgeSource: insight.bridgeSource` to **preserve** the original value — omitting the field defaults it to `null`, which strips the stale-cleanup immunity and makes the insight eligible for the periodic sweep.

**Never call `resolveInsight('in_progress')` as a cleanup-protection hack.** That state is reserved for admin resolutions; using it here silently overwrites genuine admin decisions.

The pr-check rule `bridgeSource missing on upsertInsight inside bridge` catches the new-insight case. The re-upsert case is a manual review item.

## Rule 2 — Score adjustments

**Use `applyScoreAdjustment()` from `server/insight-score-adjustments.ts`.**

Never store independent `_*BaseScore` fields on the insight row to "remember" a pre-bridge score. Those fields don't compose across bridges — a second bridge adjusting the same insight will read a stale base and compute the wrong result. `applyScoreAdjustment()` is idempotent and composable.

## Rule 3 — Broadcast

**Return `{ modified: N }` from bridge callbacks. Never manually import or call `broadcastToWorkspace` inside a bridge.**

`executeBridge()` in `server/bridge-infrastructure.ts` auto-broadcasts `INSIGHT_BRIDGE_UPDATED` with payload `{ bridge: flag }` when `modified > 0`. Calling `broadcastToWorkspace()` directly produces a double-dispatched WS event, causing UI flicker on the client and masking real retries behind idempotency guards.

Enforced by pr-check rule `broadcastToWorkspace inside bridge callback`.

## Rule 4 — Resolution respect

**Never call `resolveInsight()` inside a bridge callback** unless the bridge's explicit purpose is resolution management (e.g. the "auto-resolve stale anomalies" bridge).

A bridge that upserts data should never mark an insight resolved — that's the admin's job. Calling `resolveInsight()` from a data-bridge wipes user decisions every time the upstream data refreshes.

## Related

- [docs/rules/analytics-insights.md](./analytics-insights.md) — insight lifecycle, data contracts, `InsightDataMap`
- [docs/rules/automated-rules.md](./automated-rules.md) — which of these rules are mechanized today
- [docs/rules/ai-dispatch-patterns.md](./ai-dispatch-patterns.md) — AI-call-before-DB-write race pattern
- `server/bridge-infrastructure.ts` — `executeBridge()` implementation
- `server/insight-score-adjustments.ts` — `applyScoreAdjustment()` canonical helper
