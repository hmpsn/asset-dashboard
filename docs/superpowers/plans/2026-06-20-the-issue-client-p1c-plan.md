# The Issue (Client) P1c — Email Return-Hook Implementation Plan

> **For agentic workers:** additive feature slice on top of the EXISTING mature email stack
> (nodemailer + queue + throttle + templates + recipient policies). Steps use checkbox (`- [ ]`) syntax.
> This is ONE phase / ONE PR. Phase-per-PR: do not start P2 until this is merged + green on staging.

**Goal:** When something worth returning for happens for a workspace — new captured customers/leads, new measured money, or a decision still waiting on the client — send the client ONE consolidated weekly "here's what came in" email that pulls them back to their Issue dashboard. Email only (NO SMS). Flag-gated OFF; nothing sends until the owner enables `the-issue-client-return-hook` + promotes to staging.

**Architecture:** A new weekly-idempotent cron (clone of `strategy-issue-cron.ts`) assembles a per-workspace digest from existing data (form submissions, `computeROI` verdict, pending client decisions), and — only when ≥1 section has real content — queues ONE `client_return_hook` email through the existing `queueEmail` → throttle → batch → send pipeline, then stamps a weekly marker and logs an operator activity. No new email transport, queue, or send path is built.

**Tech Stack:** Express + TypeScript + better-sqlite3; existing `server/email*.ts` stack; nodemailer SMTP.

---

## Feasibility (from the 2026-06-20 P1c infra discovery — 7-area sweep)

**Already exists (reuse, do not rebuild):**
- `server/email.ts` — nodemailer SMTP transport, `sendEmail()`, `makeEvent()`, `queueEmail()`, `notifyClientXxx()` helper pattern, `isEmailConfigured()`.
- `server/email-queue.ts` — batches by `(recipient, type, workspaceId)` over a 5-min window, persists to disk, retries 3×, dead-letters, restores on restart. Calls `renderDigest(type, events)`.
- `server/email-throttle.ts` — `CATEGORY_MAP` (EmailEventType → category) + `LIMITS` (per-category window) + global 5/day non-transactional cap; `email_sends` table (migration 022).
- `server/email-templates.ts` — `EmailEventType` union (line 167), `CLIENT_EMAIL_PAYLOAD_RULES` (line 200), `getEmailEventPayloadIssues()` (line 230), `renderDigest()` switch (line 281), `layout()` / `itemRow()` / `statRow()` / `countPill()` helpers, `deriveLogoUrl()`. `renderClientBriefingReady` (line 647) is the closest analog.
- `server/notification-recipients.ts` — `CLIENT_NOTIFICATION_RECIPIENT_POLICIES` (EmailEventType → authority); `workspace_primary` authority resolves to `workspace.clientEmail`. `listClientNotificationRecipients(workspaceId, eventType)`.
- `server/strategy-issue-cron.ts` — the weekly-idempotent cron template: `currentWeekOfUTC()` (exported), per-process `runningPushes` mutex, hourly tick, eligibility gate, week stamp BEFORE side effects, best-effort doorbell. **Clone this.**
- `server/workspaces.ts` — `lastIssuePushedWeekOf` / `markIssuePushedWeek` weekly-marker pattern across 7 sites (Row iface, `rowToWorkspace`, UPDATE stmt, serialize, `updateWorkspace` Pick, camel→snake map, marker fn). **Mirror this exactly.**
- `server/form-submissions.ts` — `countFormSubmissions(wsId, {startDate,endDate})` (anonymous count), `loadFormSubmissionsPaged(wsId, {limit,offset})` (PII rows, newest first), `getFormCaptureStatus`.
- `server/roi.ts` `computeROI(wsId)` → `.outcomeVerdict` (outcomeCount, estimatedValue, baselineDeltaCount, provenance) — **NOTE: `computeROI` writes a snapshot (`saveSnapshot`), so it is NOT pure-read; call it from the cron tick (a write context), never from a "pure" assembler.**
- Pending-decision sources: `listClientActions(wsId)` (server/domains/inbox/*) + approval batches — items with `status==='pending'`.
- `server/activity-log.ts` — `addActivity()`; `ActivityType` union; `CLIENT_VISIBLE_TYPES` (the new send-activity must NOT be added there — it is operator-only).
- `shared/types/feature-flags.ts` — `the-issue-client-return-hook` (default OFF, staging-validation) already defined + already gates the P1b export routes. No flag changes needed.

**Must build (the slice):** a new `EmailEventType` + its renderer + throttle/recipient mapping + `notifyClientReturnHook()` helper; a digest assembler; a weekly cron + startup registration; a workspace weekly-marker column (migration 151); a new operator-only `ActivityType`. Plus tests.

**Confirmed NOT in scope (per owner + discovery):** SMS (email only); platform-wide unsubscribe/preference-center/List-Unsubscribe/suppression-table/bounce-handling (no existing client email has it — deferred as its own roadmap item; a plain "reply to stop" footer line is the only courtesy added); per-event/daily cadence (weekly only); per-workspace cadence-config UI; CRM sync; server-side PDF.

---

## Decision Register

- **DR-1 — Cadence: weekly, event-gated (OWNER-CONFIRMED).** One email/week max. Fixed weekly cron (Monday anchor, `currentWeekOfUTC`), 7-day lookback. **Only sends when ≥1 section has real content** — silent on dead weeks (no stamp written on a no-content week, so it can fire later that week if content appears, but at most once per ISO week). Matches the briefing/issue cron cadence.
- **DR-2 — One consolidated email, not three.** A single `client_return_hook` EmailEventType with up to 3 conditional sections (new customers · new measured money · decision waiting). One renderer, one throttle entry, one recipient policy. Avoids 3× volume.
- **DR-3 — Decision-waiting = still-pending REMINDER, not a re-send.** The platform already emails `approval_ready`/`curated_recs_sent` at send time. P1c's decision section is a gentle "N item(s) still waiting for your input" computed from CURRENT pending state — net-new (a week-later nudge), never a duplicate of the initial send. No new send-time trigger; it is a digest section.
- **DR-4 — Recipient: `workspace.clientEmail` via `workspace_primary` authority.** If absent → no send (graceful no-op, like every other client email). Not `portalContacts`, not `client_users`.
- **DR-5 — Throttle: new `return` category, weekly window (`maxPerWindow: 1, windowDays: 7`).** Backstop to the cron's week-marker (defense in depth) and correct global-cap accounting. Counts toward the 5/day non-transactional cap.
- **DR-6 — Opt-out: match existing pattern + "reply to stop" footer (OWNER-CONFIRMED).** No new unsubscribe infra. Footer line: "You're receiving this because hmpsn.studio manages your site — reply to stop these." Platform-wide preference center + List-Unsubscribe + suppression table is a SEPARATE deferred roadmap item (`email-preference-center`), logged in `data/roadmap.json`.
- **DR-7 — Trigger: a new weekly cron, NOT inline mutation-time hooks.** Inline-per-event would spam; the weekly cron with content-gating is the cadence guard. Registered in `server/startup.ts`.
- **DR-8 — Money section is activity-gated.** The measured-money section appears ONLY when this week had new captured leads/outcomes (real new activity), never a static weekly restatement of the same number. This makes "new money" actually new.
- **DR-9 — Money requires `measured_action` provenance + value set.** Reuse `computeROI().outcomeVerdict`; show money only when `provenance==='measured_action'` (or `actual_reconciled`) AND `outcomeValue` is set. Otherwise omit the money section (an estimate is not "your money came in").
- **DR-10 — Flag gate composition.** Every send path guards on `isFeatureEnabled('the-issue-client-return-hook', ws.id)`. The whole cron tick early-returns when the flag is globally OFF (byte-identical OFF). The spine flag (`the-issue-client-spine`) is the verdict prerequisite but `computeROI` already gates the verdict on it, so checking the return-hook flag suffices for the email; the money section naturally empties when the spine is off.

---

## File Structure

**New files:**
- `server/db/migrations/151-workspace-return-hook-marker.sql` — `last_return_hook_sent_week_of TEXT` column.
- `server/the-issue-return-hook.ts` — `assembleReturnHookDigest(workspaceId): ReturnHookDigest | null` (pure-read of leads + pending decisions) + `ReturnHookDigest` type. (Money is added by the cron, which owns the `computeROI` write.)
- `server/return-hook-cron.ts` — `startReturnHookCron()` / `stopReturnHookCron()` / `runReturnHookForWorkspace(wsId, opts)` (clone of strategy-issue-cron).
- `tests/unit/the-issue-return-hook.test.ts` — assembler unit tests.
- `tests/integration/the-issue-return-hook-cron.test.ts` — cron + flag-gating + idempotency + send/no-send integration.
- `tests/unit/the-issue-return-hook-email.test.ts` — renderer + payload-rule + throttle-category + recipient-policy tests.

**Modified files:**
- `shared/types/the-issue.ts` — export `ReturnHookDigest` (+ section types).
- `server/email-templates.ts` — add `client_return_hook` to `EmailEventType`, `CLIENT_EMAIL_PAYLOAD_RULES`, `renderDigest` switch, `renderClientReturnHook()`.
- `server/email-throttle.ts` — add `return` to `ThrottleCategory`, `CATEGORY_MAP['client_return_hook']='return'`, `LIMITS.return`.
- `server/notification-recipients.ts` — add `client_return_hook` → `workspace_primary` policy.
- `server/email.ts` — add `notifyClientReturnHook(opts)` helper.
- `server/activity-log.ts` — add `client_return_hook_sent` ActivityType (NOT in CLIENT_VISIBLE_TYPES).
- `server/workspaces.ts` — mirror the 7-site marker plumbing for `lastReturnHookSentWeekOf` + `markReturnHookSentWeek(wsId, weekOf)`.
- `server/startup.ts` — `startReturnHookCron()`.
- `scripts/platform-domain-event-definitions.ts` — register the new activity type under `outcomes-roi` relatedActivityTypes (keeps the domain-event catalog in sync).
- `data/roadmap.json` — mark P1c done; add deferred `email-preference-center` item.
- `FEATURE_AUDIT.md` — P1c entry.

---

## Dependency graph / lanes

- **Lane A (contract root — commit FIRST):** migration 151 + workspaces.ts marker plumbing + `ReturnHookDigest` type in shared/types + `client_return_hook` EmailEventType + payload rule + throttle category + recipient policy + ActivityType + domain-event registration. Everything else imports these. (Mostly mechanical; touches email-templates.ts type+rules ONLY, not the renderer yet — to keep B's ownership clean, Lane A adds the union member + payload rule + a `renderDigest` case that throws "not implemented" placeholder is NOT allowed; instead Lane A adds the union member and Lane B owns the renderer + switch case. To avoid a broken intermediate, Lane A and Lane B land in the SAME commit if a subagent split would leave `renderDigest` non-exhaustive. Given the tight coupling, build A+B inline/sequentially rather than parallel.)
- **Lane B:** `renderClientReturnHook()` + `renderDigest` switch case + `notifyClientReturnHook()` in email.ts.
- **Lane C:** `assembleReturnHookDigest()` + `return-hook-cron.ts` + startup registration.
- **Lane D:** tests (assembler, renderer/payload/throttle/recipient, cron integration with flag-OFF byte-identical + weekly idempotency + content-gating).

**Build order:** A → B → C → D, mostly sequential (heavy file coupling on `email-templates.ts` + `workspaces.ts` makes parallel subagents conflict-prone). Controller gate after the batch: `typecheck && vite build && pr-check && verify:feature-flags && full vitest`. Then scaled adversarial review → fix → re-gate.

---

## Key contracts (exact shapes)

```ts
// shared/types/the-issue.ts (additive)
export interface ReturnHookLeadSection {
  count: number;                 // leads captured in the 7-day window
  recentNames: string[];         // up to 3 most-recent lead display names (client's OWN PII — to the client)
  outcomeNoun: string;           // segment plural noun ("new patients" | "qualified leads" | …)
}
export interface ReturnHookMoneySection {
  estimatedValue: number;        // verdict.estimatedValue (measured_action only)
  outcomeCount: number;
  sinceStartDelta: number | null;// verdict.baselineDeltaCount
  outcomeNoun: string;
}
export interface ReturnHookDecisionSection {
  pendingCount: number;          // client actions + approval batches still status==='pending'
}
export interface ReturnHookDigest {
  workspaceId: string;
  leads: ReturnHookLeadSection | null;     // null when no leads this week
  money: ReturnHookMoneySection | null;    // null unless measured_action + value set + this-week activity
  decision: ReturnHookDecisionSection | null; // null when nothing pending
  /** true when ≥1 section is non-null — the cron only sends when this is true. */
  hasContent: boolean;
}
```

```ts
// email payload contract (CLIENT_EMAIL_PAYLOAD_RULES['client_return_hook'])
// data: { leadCount?:number, recentNames?:string[], outcomeNoun:string,
//         moneyValue?:number, sinceStartDelta?:number|null, pendingCount?:number,
//         onePagerUrl?:string }
// requiredStrings: ['outcomeNoun']   (the rest are conditional sections — validated by the assembler)
```

---

## Tasks (bite-sized)

### Task A1 — Migration 151: workspace return-hook marker
- [ ] Create `server/db/migrations/151-workspace-return-hook-marker.sql`:
```sql
-- The Issue (Client) P1c — weekly return-hook send marker (idempotency, mirrors last_issue_pushed_week_of).
ALTER TABLE workspaces ADD COLUMN last_return_hook_sent_week_of TEXT;
```
- [ ] `npm run db:migrate` locally to confirm it applies.

### Task A2 — workspaces.ts marker plumbing (mirror lastIssuePushedWeekOf at all 7 sites)
- [ ] Row interface: add `last_return_hook_sent_week_of: string | null;` near line 167.
- [ ] `rowToWorkspace`: `ws.lastReturnHookSentWeekOf = row.last_return_hook_sent_week_of ?? null;` near line 285.
- [ ] Workspace type (shared/types/workspace.ts): add `lastReturnHookSentWeekOf?: string | null;` beside `lastIssuePushedWeekOf`.
- [ ] Serialize map (line ~429): `last_return_hook_sent_week_of: ws.lastReturnHookSentWeekOf ?? null,`.
- [ ] `updateWorkspace` Pick union (line 508): add `'lastReturnHookSentWeekOf'`.
- [ ] camel→snake map (line ~553): `lastReturnHookSentWeekOf: 'last_return_hook_sent_week_of',`.
- [ ] Add `markReturnHookSentWeek(workspaceId, weekOf)` mirroring `markIssuePushedWeek` (lazy UPDATE stmt `UPDATE workspaces SET last_return_hook_sent_week_of = ? WHERE id = ?`).
- [ ] `AdminWorkspaceView` (toAdminWorkspaceView) — only if other week-of markers are serialized there; otherwise skip (the marker is operator-internal).

### Task A3 — shared types + email type + throttle + recipient + activity (contract surface)
- [ ] `shared/types/the-issue.ts`: add the `ReturnHook*` interfaces above.
- [ ] `server/email-templates.ts`: add `| 'client_return_hook'` to `EmailEventType`; add `client_return_hook: { requiredStrings: ['outcomeNoun'] }` to `CLIENT_EMAIL_PAYLOAD_RULES`.
- [ ] `server/email-throttle.ts`: add `'return'` to `ThrottleCategory`; `CATEGORY_MAP: client_return_hook: 'return'`; `LIMITS.return = { maxPerWindow: 1, windowDays: 7 }`.
- [ ] `server/notification-recipients.ts`: add `client_return_hook: { authority: 'workspace_primary' }`.
- [ ] `server/activity-log.ts`: add `'client_return_hook_sent'` to `ActivityType` (do NOT add to `CLIENT_VISIBLE_TYPES`).
- [ ] `scripts/platform-domain-event-definitions.ts`: add `'client_return_hook_sent'` to the `outcomes-roi` (or `analytics-intelligence`) `relatedActivityTypes` array.

### Task B1 — renderClientReturnHook + renderDigest case
- [ ] Add the `case 'client_return_hook': result = renderClientReturnHook(events, count, ws, dashUrl, logoUrl); break;` to the `renderDigest` switch.
- [ ] Implement `renderClientReturnHook(events, _count, ws, dashUrl, logoUrl)`: take `events[0].data`; compose up to 3 `itemRow`/`countPill` sections (leads with `recentNames` joined, money with `$value` + `+delta since we started`, decision with `pendingCount`); `subject` = segment-framed "What came in this week at {ws}"; `cta` = dashUrl ("See your dashboard"); footer = the DR-6 "reply to stop" line. Escape all interpolated strings via the helpers (they esc internally; raw-HTML body substrings use `esc()`).

### Task B2 — notifyClientReturnHook helper
- [ ] In `server/email.ts`, add `notifyClientReturnHook(opts: { clientEmail; workspaceName; workspaceId; dashboardUrl?; data })`: early-return if `!isEmailConfigured()` or `!opts.clientEmail`; `queueEmail(makeEvent('client_return_hook', opts.clientEmail, opts.workspaceId, opts.workspaceName, opts.dashboardUrl, opts.data))`.

### Task C1 — assembleReturnHookDigest (pure-read)
- [ ] `server/the-issue-return-hook.ts`: `assembleReturnHookDigest(workspaceId)`:
  - `getWorkspace`; null guard.
  - Leads: `countFormSubmissions(wsId, last7d)`; if >0, `loadFormSubmissionsPaged(wsId,{limit:3,offset:0})` → `recentNames` (leadName ?? leadEmail ?? '—'); `outcomeNoun` from `resolveSegmentProfile(ws).outcomeNounPlural`.
  - Decision: count pending client actions + pending approval batches.
  - `hasContent = !!(leads || decision)` at this layer (money is added by the cron — see C2).
  - Returns `ReturnHookDigest` with `money: null` placeholder (cron fills it).

### Task C2 — return-hook-cron.ts (clone strategy-issue-cron)
- [ ] `runReturnHookForWorkspace(wsId, opts)`: per-process mutex; flag gate `the-issue-client-return-hook`; `clientEmail` present gate; `weekOf = currentWeekOfUTC` (import from strategy-issue-cron or copy the helper); duplicate-week guard on `lastReturnHookSentWeekOf` (manual bypass).
  - Assemble digest (C1). Compute money: `computeROI(wsId)` (the cron is the write context); if `verdict.provenance==='measured_action'|'actual_reconciled'` AND `ws.outcomeValue` set AND **this week had leads** (DR-8), set the money section.
  - Recompute `hasContent` including money. **If `!hasContent` → return `{status:'skipped', reason:'no content'}` WITHOUT stamping** (so a later tick that week can still fire when content appears).
  - Build `data` payload + `dashboardUrl` (client Issue page via `clientPath`) + `onePagerUrl`.
  - `markReturnHookSentWeek(wsId, weekOf)` BEFORE the send side-effect (mirror DR ordering). `notifyClientReturnHook(...)`. `addActivity('client_return_hook_sent', …)` (operator-only). Best-effort doorbell try/catch.
  - Return `{status:'sent', weekOf}`.
- [ ] `tick()` + `startReturnHookCron()` / `stopReturnHookCron()`: clone strategy-issue-cron exactly (hourly poll, global-flag early-return, `lastTickRunWeek` memo, per-workspace loop, no-stamp-on-error).
- [ ] `server/startup.ts`: import + call `startReturnHookCron()` beside `startStrategyIssueCron()`.

### Task D — tests (see Test Plan)

---

## Test Plan

- **Assembler unit** (`tests/unit/the-issue-return-hook.test.ts`): null for missing ws; leads section populated from form_submissions in-window (and null when none, and only ≤3 names); decision section from pending actions/batches; `hasContent` correctness; PII-free vs the COUNT path (recentNames are the client's own — assert they ARE present here since this goes to the client).
- **Email unit** (`tests/unit/the-issue-return-hook-email.test.ts`): `renderClientReturnHook` renders each section conditionally; subject + CTA + reply-to-stop footer present; `getEmailEventPayloadIssues` passes a valid payload and flags a missing `outcomeNoun`; `getThrottleCategory('client_return_hook')==='return'`; recipient policy authority is `workspace_primary`; no purple/PII-leak of `leadMessage`.
- **Cron integration** (`tests/integration/the-issue-return-hook-cron.test.ts`): flag-OFF → `runReturnHookForWorkspace` no-ops, NO email queued, NO marker stamped (byte-identical OFF); flag-ON + content → exactly one email queued + marker stamped + activity logged; flag-ON + NO content → no send + NO stamp (re-runnable); duplicate-week guard (second run same week → `duplicate`, no second email); no `clientEmail` → no send; money section only on measured_action + value + this-week leads.
- Reuse `createEphemeralTestContext` + `seedWorkspace` + `setWorkspaceFlagOverride` + `saveFormSubmission` + `saveGa4Snapshot` fixtures (as in the P1b export tests). Mock/spy the queue (`registerSendFn` or assert via `email_sends`/queue introspection) — do NOT bind SMTP.

---

## Quality Gates (this PR)
- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — succeeds
- [ ] `npx vitest run` — full suite green (not just new tests)
- [ ] `npx tsx scripts/pr-check.ts` — zero errors
- [ ] `npm run verify:feature-flags` — no orphaned/ungrouped keys (no flag added, but the catalog still validates)
- [ ] Scaled adversarial review (multi-agent) — fix Critical/Important before push
- [ ] `FEATURE_AUDIT.md` + `data/roadmap.json` updated (P1c done; `email-preference-center` deferred item added)
- [ ] Phase-per-PR: this is P1c only. Staging soak + legacy cutover/teardown come AFTER all of P1 is built (owner-locked sequence).

---

## Deferred (logged, not built here)
- `email-preference-center` — platform-wide unsubscribe / List-Unsubscribe header / suppression table / per-type opt-out toggles / bounce + complaint handling. Applies to ALL 22 existing client email types, not just the return hook. Its own spec + plan + PR.
- Per-workspace return-hook cadence config (daily/weekly/off UI) — weekly fixed is the MVP.
- HubSpot/CRM sync (already deferred at the roadmap level).
