# Client Email Surface Audit - 2026-06-12

## Scope

This audit covers outbound email paths that can reach clients, plus adjacent team-only email helpers that are often confused with client notifications. It was originally written against `origin/staging` after PR #1225 and updated by the autonomous maintenance follow-ups to record resolved findings.

Primary files reviewed:

- `server/email.ts`
- `server/email-templates.ts`
- `server/email-queue.ts`
- `server/email-throttle.ts`
- `server/approval-reminders.ts`
- `server/monthly-report.ts`
- `server/trial-reminders.ts`
- `server/routes/public-auth.ts`
- `server/routes/requests.ts`
- `server/routes/content-briefs.ts`
- `server/routes/content-requests.ts`
- `server/domains/content/send-post-to-client.ts`
- `server/routes/briefing.ts`
- `server/briefing-cron.ts`
- `server/routes/approvals.ts`
- `server/domains/inbox/*`
- `server/routes/work-orders.ts`
- `server/seo-audit-background-job.ts`
- `server/scheduled-audits.ts`
- `server/anomaly-detection.ts`
- `server/stripe.ts`
- `server/notification-recipients.ts`

## Infrastructure Snapshot

Most client notifications go through `queueEmail()`, which batches by `recipient:type:workspaceId` for 5 minutes. Status emails wait until the next morning digest window. `email-throttle.ts` applies:

| Category | Event types | Limit |
| --- | --- | --- |
| `status` | `request_status`, `request_response` | 1 per day, morning digest |
| `audit` | `audit_complete`, `recommendations_ready` | 1 per 14 days |
| `action` | `approval_ready`, `content_brief_ready`, `content_post_ready`, `content_published`, `fixes_applied`, `client_briefing_ready`, work-order client replies | 3 per day |
| `alert` | `anomaly_alert`, `audit_alert` | 1 per day |
| `transactional` | `password_reset`, `client_welcome`, `trial_expiry_warning` | unthrottled |
| `internal` | team-only notifications | unthrottled |
| `report` | monthly or weekly report | handled by `monthly-report.ts` |

All queued non-transactional client emails also count toward the global cap of 5 non-transactional client emails per day.

Recipient authority now lives in `server/notification-recipients.ts`: most client notifications resolve to `workspace.clientEmail`, work-order client notifications resolve to `client_users.email`, and password reset/client welcome remain caller-owned explicit-recipient events.

## Client-Facing Matrix

| Workflow | Trigger route/job/source | Audience | Template/event type | Throttle/dedupe | Required payload | Expected user-visible outcome | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Generic deliverable or SEO approval sent | `createAdminClientAction()`, `createApprovalBatchForClient()`, `sendDeliverable()`, `sendSchemaPlanToClient()` | `workspace.clientEmail` | `approval_ready` | Queued, `action`, 5-minute batching, global daily cap | `batchName`, `itemCount`, `dashboardUrl` | Client receives a "Changes Ready for Review" email with review CTA | Covers legacy approval batches, client actions, schema strategy review, and unified deliverables. |
| Unified deliverable reminder | `remindDeliverable()` via `POST /api/deliverables/:workspaceId/:id/remind` | `workspace.clientEmail` | `renderApprovalReminder()` direct send | `action` throttle, `sent_reminders` key `deliverable:<deliverable.id>`, 3-day resend window | `workspaceName`, deliverable title, item count, stale days, `dashboardUrl` | Client gets reminder copy for the pending deliverable | Normalized after the original audit; route response/activity/broadcast remain non-blocking. |
| Legacy approval reminder, automatic | `checkStaleApprovals()` in `server/approval-reminders.ts` | `workspace.clientEmail` | `renderApprovalReminder()` direct send | `action` throttle, `sent_reminders` key `approval:<batch.id>`, 3-day resend window | `workspaceName`, `batchName`, `pendingCount`, `staleDays`, `dashboardUrl` | Client is nudged about stale pending approval items | Direct send bypasses queue batching but records `email_sends`. |
| Legacy approval reminder, manual | `POST /api/approvals/:workspaceId/:batchId/remind` | `workspace.clientEmail` | `renderApprovalReminder()` direct send | `action` throttle; does not update `sent_reminders` | Same as automatic reminder | Admin can manually nudge the client | Manual route validates pending items and configured email before sending. |
| Content brief sent for review | `POST /api/content-briefs/:workspaceId/:briefId/send-to-client`; `PATCH /api/content-requests/:workspaceId/:id` to `client_review` | `workspace.clientEmail` | `content_brief_ready` | Queued, `action` | `topic`, `targetKeyword`, `dashboardUrl` | Client receives a brief-review CTA | The brief route dedupes open content requests before notifying. The generic status patch has no event-level dedupe beyond queue/throttle. |
| Content post sent for review | `PATCH /api/content-requests/:workspaceId/:id` to `post_review`; `sendPostToClient()` domain service | `workspace.clientEmail` | `content_post_ready` | Queued, `action` | `topic`, `targetKeyword`, `dashboardUrl` | Client receives a post-review CTA | Two admin/service paths can send this event. Keep future send paths centralized through `sendPostToClient()` where possible. |
| Content published | `PATCH /api/content-requests/:workspaceId/:id` to `published` | `workspace.clientEmail` | `content_published` | Queued, `action` | `topic`, optional `targetKeyword`, `dashboardUrl` | Client is told published content is live | Only the content-request status route sends this. Webflow publish domain code logs outcome data but does not send this email directly. |
| Weekly briefing published manually | `POST /api/briefing/:workspaceId/drafts/:id/publish` | `workspace.clientEmail` | `client_briefing_ready` | Queued, `action` | `weekOf`, `storyCount`, `heroHeadline`, `dashboardUrl` | Client receives a briefing CTA | Gated by `client-briefing-v2`. |
| Weekly briefing auto-published | `briefing-cron.ts` auto-publish path | `workspace.clientEmail` | `client_briefing_ready` | Queued, `action` | Same as manual publish | Client receives a briefing CTA | Also gated by `client-briefing-v2`; path explicitly passes `dashboardUrl`. |
| Admin updates request status | `PATCH /api/requests/:id` when status changes | `workspace.clientEmail` | `request_status` | Queued, `status`, morning digest, 1 per day | `requestTitle`, `newStatus`, `dashboardUrl` | Client sees request status changes in a digest | Only fires when status differs from previous status. |
| Admin replies to request | `POST /api/requests/:id/notes`; `POST /api/requests/:id/notes-with-files` when content exists | `workspace.clientEmail` | `request_response` | Queued, `status`, morning digest, 1 per day | `requestTitle`, `noteContent`, `dashboardUrl` | Client receives a conversation update | Attachment-only team notes do not send unless there is note content. |
| Work-order fix completed | `PATCH /api/work-orders/:workspaceId/:orderId` to `completed` | `client_users.email` via `listClientNotificationRecipients(..., 'fixes_applied')` | `fixes_applied` | Queued, `action` per recipient | `productType`, `pageCount`, `dashboardUrl` | Client user is told purchased fixes are live with a dashboard CTA | Audience differs from most workspace-level emails by explicit recipient policy. |
| Team replies on work order | `POST /api/work-orders/:workspaceId/:orderId/comment` | `client_users.email` via `listClientNotificationRecipients(..., 'work_order_comment_client')` | `work_order_comment_client` | Queued, `action` per recipient | `orderTitle`, `message`, `dashboardUrl` | Client user receives a work-order conversation reply with a dashboard CTA | Audience differs from most workspace-level emails by explicit recipient policy. |
| Audit complete from background job | `seo-audit-background-job.ts` after audit completion | `workspace.clientEmail` | `audit_complete` | Queued, `audit`, 1 per 14 days | `score`, optional `previousScore`, `totalPages`, `errors`, `warnings`, `topIssues`, `fixedCount`, `dashboardUrl` | Client receives health-score summary and CTA to Health | Also sends `recommendations_ready` when non-backfilled recommendations exist. |
| Audit complete from scheduler | `scheduled-audits.ts` | `workspace.clientEmail` | `audit_complete` | Queued, `audit`, 1 per 14 days | Same as background job | Client receives health-score summary | Duplicates background-job template shape, but from scheduled audit path. |
| Recommendations ready after audit | `seo-audit-background-job.ts` | `workspace.clientEmail` | `recommendations_ready` | Queued, `audit`, 1 per 14 days | `recCount`, `dashboardUrl` | Client is told new recommendations are ready | Counts active, non-dismissed, non-backfilled recommendations. |
| Critical anomaly alert | `anomaly-detection.ts` when critical anomaly exists | `workspace.clientEmail` | `anomaly_alert` | Queued, `alert`, 1 per day | `title`, `description`, `severity`, `source`, `changePct`, optional `aiSummary`, `dashboardUrl` | Client receives a critical anomaly alert with a dashboard CTA | Warnings go team-only. |
| Monthly or weekly report | `monthly-report.ts` when `workspace.autoReports` is true | `workspace.clientEmail` | `renderMonthlyReport()` direct send | `report`; period dedupe via `.report-sent.json` keyed by workspace and current week/month | Workspace health, request counts, approval counts, activity, traffic, chat topics, trial state | Client receives periodic performance report | Direct send bypasses queue; records `email_sends` as `monthly_report` even when frequency is weekly. |
| Trial expiry warning | `trial-reminders.ts` | `workspace.clientEmail` | `trial_expiry_warning` direct send | Transactional; `sent_reminders` keys `trial:<workspaceId>:4` and `trial:<workspaceId>:1` | `daysRemaining`, dashboard `/plans` URL | Client gets 4-day and 1-day Growth trial warnings | Direct send bypasses queue and marks reminder only after successful send. |
| Password reset | `POST /api/public/forgot-password/:id` | Submitted email if `createResetToken()` accepts it | `password_reset` direct send | Transactional; token TTL handled by auth store | `resetUrl` | Client can reset password | Response is enumeration-safe. Email is direct send, not queued. |
| Client welcome | `POST /api/workspaces/:id/client-users` | Newly created client user email | `client_welcome` | Queued, transactional | `clientName`, `dashboardUrl` | New client user receives dashboard welcome | Uses client user address, not `workspace.clientEmail`. |

## Adjacent Team-Only or Dormant Email Paths

| Surface | Trigger/source | Audience | Event/template | Current status |
| --- | --- | --- | --- | --- |
| Client-created generic request | `POST /api/public/requests/:workspaceId` | `NOTIFICATION_EMAIL` | `request_new` | Team-only notification. No client confirmation email. |
| Client request follow-up or attachments | Public request note/attachment routes | `NOTIFICATION_EMAIL` | `request_new` | Team-only follow-up signal using the new-request template. |
| Client content topic request | `server/routes/public-content.ts` topic request paths | `NOTIFICATION_EMAIL` | `content_request` | Team-only notification. |
| Client approves brief/post/approval/action | Public content and inbox response routes | `NOTIFICATION_EMAIL` | `action_approved` | Team-only notification. |
| Client requests changes on brief/post/approval/action | Public content and inbox response routes | `NOTIFICATION_EMAIL` | `content_changes_requested` | Team-only notification. |
| Client comments on work order | Public work-order comment route in `server/routes/public-content.ts` | `NOTIFICATION_EMAIL` | `work_order_comment_team` | Team-only notification. |
| Stripe checkout payment received | `server/stripe.ts` checkout completion | `NOTIFICATION_EMAIL` | `payment_received` | Team-only notification. Stripe-hosted receipts are the client receipt authority; the platform intentionally does not send a duplicate client receipt email. |
| Churn signal | `server/churn-signals.ts` | `NOTIFICATION_EMAIL` | `churn_signal` | Team-only notification. |
| Client AI service intent signal | `public-analytics.ts` and `client-signals.ts` | `NOTIFICATION_EMAIL` | `client_signal` | Team-only notification. |
| Audit score improved | Removed dormant helper/template | n/a | n/a | Retired. Audit improvements flow through `audit_complete` and `recommendations_ready`; add a new event only with an intentional score-improvement workflow. |
| Audit alert | `notifyAuditAlert()` and `scheduled-audits.ts` score-drop path | `NOTIFICATION_EMAIL` | `audit_alert` | Team-only health alert. Not client-facing. |

## Findings

1. Work-order client emails were missing CTAs. Resolved: `server/routes/work-orders.ts` now passes `dashboardUrl` for fixes-applied and work-order comment emails.

2. Approval reminder semantics were split. Resolved: unified deliverable reminders now use reminder copy and `sent_reminders` dedupe keyed by `deliverable:<id>`.

3. Billing has no in-app client receipt surface by design. Contract decision: Stripe-hosted receipts are the client receipt authority; `payment_received` stays team-only to avoid duplicate receipts.

4. `audit_improved` was a dormant client-facing template. Resolved: the unused helper/template/event type was retired.

5. Critical anomaly client alerts were missing CTAs. Resolved: `anomaly-detection.ts` now passes `dashboardUrl`.

6. Recipient authority is now documented in code. `server/notification-recipients.ts` defines workspace-primary, client-user, and explicit-recipient policies. Existing work-order client notifications use the resolver; other send paths retain their current behavior until preferences require broader migration.

7. Content review notifications depend on multiple send paths.
   Brief/post review emails are triggered from route-level status changes and the newer `sendPostToClient()` service. There is no event-level idempotency beyond queue batching/throttle, so future routes should avoid adding another direct status-based sender.

## Recommended Follow-Up PRs

1. Keep future content review sends centralized.
   Scope: route new brief/post review send paths through the existing content send services or add event-level idempotency before introducing another status-based sender.

2. Build notification preferences on top of `server/notification-recipients.ts`.
   Scope: add per-user preference fields and apply them inside the resolver rather than scattering preference checks across send sites.
