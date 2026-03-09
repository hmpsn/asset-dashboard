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

## 8. Auth & User Identity

When adding new endpoints or modifying existing ones, follow these patterns for auth integration:

### Protecting admin routes
```typescript
// Any logged-in internal user
app.get('/api/my-route', requireAuth, handler);

// Role-restricted (admin or owner only)
app.post('/api/my-route', requireAuth, requireRole('admin', 'owner'), handler);

// Workspace-scoped (checks user.workspaceIds)
app.get('/api/workspaces/:id/data', requireWorkspaceAccess(), handler);
```

### Accessing current user in handlers
- `req.user` — populated by `optionalAuth` (global) or `requireAuth`. Contains `SafeUser` (no passwordHash).
- `req.user?.id`, `req.user?.name`, `req.user?.role`, `req.user?.workspaceIds`
- Always check `req.user` existence before accessing properties (may be `undefined` if only legacy auth)

### Client user identity
- Client user JWT is in `client_user_token_<wsId>` cookie
- Use `verifyClientToken(token)` to get `{ clientUserId, email, role, workspaceId }`
- Use `getSafeClientUser(id)` to get full client user profile

### Adding user attribution to features
1. Check `req.user` in the handler
2. Pass `userId`/`userName` to `addActivity()` metadata
3. Store `userId` on any records that should track authorship (requests, approvals, comments)

### Reference
See `.windsurf/workflows/auth-system.md` for full auth system documentation including all endpoints, middleware stack, and common tasks.

## 9. Anomaly Detection

The anomaly detection system (`server/anomaly-detection.ts`) runs on a 12h scheduler + manual trigger:

1. **Thresholds**: Configurable in `THRESHOLDS` constant — % change that triggers an anomaly (traffic, impressions, CTR, position, bounce, conversions, audit score)
2. **Detection**: `detectForWorkspace(ws)` compares current vs previous 28-day period using `getSearchPeriodComparison` (GSC) and `getGA4PeriodComparison` (GA4), plus audit `listSnapshots` for score deltas
3. **Deduplication**: `alreadyDetected()` prevents duplicate anomalies within 48h window
4. **AI Summary**: `generateAiSummary()` calls gpt-4o-mini for a 2-3 sentence executive summary per workspace
5. **Activity logging**: Critical/warning anomalies log `anomaly_detected`; positive trends log `anomaly_positive`
6. **Storage**: JSON file at `.anomalies.json` with 60-day auto-pruning
7. **API endpoints**: `GET /api/anomalies[/:workspaceId]`, `POST /api/anomalies/:id/dismiss`, `POST /api/anomalies/:id/acknowledge`, `POST /api/anomalies/scan`, `GET /api/public/anomalies/:workspaceId`
8. **Frontend**: `AnomalyAlerts` component with `workspaceId`, `isAdmin`, `compact` props. Wired into WorkspaceHome (admin) and ClientDashboard overview.

To add a new anomaly type:
1. Add type to `AnomalyType` union and threshold to `THRESHOLDS`
2. Add detection logic in `detectForWorkspace()`
3. Map severity in `severityFor()`

## 10. Multi-Modal Chat Rendering

Chat responses can include rich structured blocks via fenced code blocks:

1. **Prompt**: `RICH_BLOCKS_PROMPT` in `seo-context.ts` — injected into all 3 chat system prompts
2. **Block types**: `metric` (stat cards), `chart` (horizontal bars), `datatable` (tables with CSV), `sparkline` (mini charts)
3. **Parsing**: `RenderMarkdown` in `helpers.tsx` detects fenced blocks with these language tags, parses JSON payload, renders corresponding `ChatBlocks.tsx` component
4. **Fallback**: Invalid JSON falls back to standard code block rendering
5. **Coverage**: Works in AdminChat, ChatPanel, and ClientDashboard (all use `RenderMarkdown`)

To add a new block type:
1. Add component in `ChatBlocks.tsx`
2. Add case in `RenderMarkdown` fenced block parser
3. Add examples in `RICH_BLOCKS_PROMPT`

## 11. WebSocket Real-Time Broadcasts

When adding real-time updates for a new feature:

1. **Server broadcast**: Call `broadcastToWorkspace(wsId, 'event:name', data)` at the point where data changes (e.g., after a DB write, after detection completes)
2. **Broadcast callback pattern** (for modules that can't import `broadcastToWorkspace` directly):
   - Add `let _broadcast: ((wsId: string, event: string, data: unknown) => void) | null = null;`
   - Export `initMyBroadcast(fn)` function
   - Call `initMyBroadcast(broadcastToWorkspace)` in `server/index.ts` alongside other broadcast inits
   - Example: `initActivityBroadcast`, `initAnomalyBroadcast`
3. **Frontend**: Use `useWorkspaceEvents(wsId, { 'event:name': (data) => refetchRelevantData() })` in the component
4. **Existing events**: `activity:new`, `approval:update`, `approval:applied`, `request:created`, `request:update`, `content-request:created`, `content-request:update`, `audit:complete`, `anomalies:update`

### ⚠️ Critical: Broadcast from BOTH admin and client endpoints

Every write endpoint has two versions — admin (`/api/...`) and client (`/api/public/...`). **Both must call `broadcastToWorkspace()`** for the same event. Without this, actions on one side won't appear in real-time on the other.

**Checklist when adding a new write endpoint pair:**
- [ ] Admin endpoint calls `broadcastToWorkspace(wsId, 'feature:event', data)`
- [ ] Client/public endpoint calls `broadcastToWorkspace(wsId, 'feature:event', data)` with the same event name
- [ ] `WorkspaceHome.tsx` `useWorkspaceEvents()` handles the event (admin side)
- [ ] `ClientDashboard.tsx` `useWorkspaceEvents()` handles the event (client side)

**Common mistake**: Only adding the broadcast to the admin endpoint. The client `/api/public/*` endpoints also need it or admin won't see client actions in real-time (and vice versa).

**Endpoints that currently broadcast correctly from both sides:**
- Approvals: `approval:update`, `approval:applied`
- Requests: `request:created`, `request:update`
- Content requests: `content-request:created`, `content-request:update`
- Activity: `activity:new` (auto via `addActivity` → `initActivityBroadcast`)
- Anomalies: `anomalies:update` (auto via `initAnomalyBroadcast`)

## 12. Email Notifications

When adding email notifications for a new event type:

1. **Add event type**: Add to `EmailEventType` union in `server/email-templates.ts`
2. **Add template**: Create `renderMyEvent()` function following existing patterns (use `layout()`, `itemRow()`, `countPill()`, badges)
3. **Add case**: Add to `renderDigest()` switch statement
4. **Add helper**: Create `notifyMyEvent()` in `server/email.ts` using `queueEmail(makeEvent(...))`
5. **Wire it**: Call the notify helper at the relevant point in server logic
6. **Recipient logic**: Use `getNotificationEmail()` for admin team, `ws.clientEmail` for client. Consider severity-based filtering (e.g., anomalies: admin gets all, client gets critical-only)

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
