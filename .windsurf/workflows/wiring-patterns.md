---
description: How to wire new data sources into AI features (chat, strategy, briefs, reports)
---

# Wiring New Data Into AI Features

When adding a new data source or analytics feature, follow these patterns to wire it across the platform.

## 1. Chat Endpoints (Client + Admin)

Both chat endpoints follow the same pattern:

### Client Chat (`/api/public/search-chat/:workspaceId` in `server/index.ts`)
1. **Frontend**: Add data to `context` object in `ClientDashboard.tsx` `buildChatContext()` function (~line 600-670). Both `askAi()` and `fetchProactiveInsight()` use this shared helper.
2. **System prompt**: Add a `${context?.newField ? '...' : ''}` line to the DATA YOU HAVE ACCESS TO section
3. **Context injection**: The full context is JSON-stringified and appended to the system prompt

### Admin Chat (`/api/admin-chat` in `server/index.ts`)
1. **Context**: Admin chat gets context from the frontend `AdminChat.tsx` component
2. **System prompt**: Add to the AVAILABLE DATA section in the admin system prompt
3. **Server-side enrichment**: Can also inject server-side data (e.g., `buildSeoContext`, `getAuditTrafficForWorkspace`)

### Shared patterns:
- Use `getAuditTrafficForWorkspace(ws)` for cached cross-reference of audit + traffic data
- Use `buildConversationContext(ws.id, sessionId, role)` for chat history
- Log first exchange: `addActivity(ws.id, 'chat_session', ...)` when `session.messages.length === 2`

## 2. Strategy Generation (`/api/webflow/keyword-strategy/:workspaceId`)

The strategy endpoint has 3 phases where data is injected:

1. **Data gathering** (steps 3-5): Parallel API calls for GSC, GA4, SEMRush data
   - Add new data fetches alongside existing ones (use `Promise.all` with `.catch(() => fallback)`)
2. **Batch page analysis** (step 6, `runBatch`): Per-page GSC data is injected into page analysis prompts
3. **Master synthesis**: Site-level strategy prompt gets all aggregated context
   - Add new context as a string section (e.g., `auditContext`, `ga4Context`)
   - Add corresponding rules to the prompt (e.g., "If X data is available, do Y")

## 3. Content Briefs (`generateBrief` in `server/content-brief.ts`)

- Pass data via the `context` parameter object
- Uses `buildSeoContext()` and `buildKeywordMapContext()` from `seo-context.ts`
- SEMRush metrics passed as `context.semrushMetrics` and `context.semrushRelated`

## 4. Monthly Reports (`server/monthly-report.ts`)

1. **Data gathering**: Add to `gatherMonthlyData()` function
2. **Interface**: Add field to `MonthlyData` interface
3. **Template**: Add to `renderMonthlyReport()` parameter type in `email-templates.ts`
4. **HTML**: Build a new section in the email template
5. **Pass-through**: Ensure both `generateReportHTML()` and `sendMonthlyReportEmail()` pass the field

## 5. Proactive Insights Pattern

The client chatbot auto-sends a greeting with data-driven insights on chat open:

1. **`buildChatContext()`** in `ClientDashboard.tsx` — shared helper that builds the full context object from all available data
2. **`fetchProactiveInsight()`** — sends a specific prompt ("greet me with 2-3 insights") to the chat API, no user message added
3. **`proactiveInsightSent` ref** — prevents duplicate greetings across re-renders
4. **`useEffect` trigger** — fires when `chatOpen` becomes true + messages are empty + data is available
5. **Quick question follow-ups** — `QUICK_QUESTIONS` displayed when exactly 1 assistant message exists (the greeting)

To add new data to proactive insights, just add it to `buildChatContext()` — it flows to both regular chat and proactive greeting.

## 6. Custom Date Range Pattern

All GSC and GA4 data fetching supports optional `startDate`/`endDate` query params:

1. **`CustomDateRange` type** exported from `server/google-analytics.ts`: `{ startDate: string; endDate: string }`
2. **`parseDateRange(req.query)`** helper in `server/index.ts` extracts params from query string
3. **Function signatures**: All GSC/GA4 functions accept `dateRange?: CustomDateRange` as final optional param
4. **Frontend**: `loadSearchData` and `loadGA4Data` accept optional `dateRange` param, append `&startDate=...&endDate=...` to fetch URLs
5. **UI**: Preset buttons call `changeDays(d)` (clears custom range); Calendar popover calls `applyCustomRange(start, end)`

## 7. Activity Logging

- Add new types to `ActivityType` union in `server/activity-log.ts`
- Call `addActivity(workspaceId, type, title, detail, metadata?)` at the relevant endpoint
- Activities show in the client dashboard Activity tab and admin Workspace Home

## Caching Pattern

For expensive cross-API data (e.g., audit + traffic):
```typescript
const cache: Record<string, { data: T; ts: number }> = {};
async function getCachedData(key: string): Promise<T> {
  const cached = cache[key];
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.data;
  const data = await fetchExpensiveData();
  cache[key] = { data, ts: Date.now() };
  return data;
}
```
