# Dependency Graph

## Most Imported Files (change these carefully)

- `server/workspace-intelligence.ts` — imported by **139** files
- `server/logger.ts` — imported by **131** files
- `server/workspaces.ts` — imported by **127** files
- `src/api/client.ts` — imported by **88** files
- `src/components/ui/index.ts` — imported by **86** files
- `server/db/index.ts` — imported by **75** files
- `server/auth.ts` — imported by **52** files
- `src/lib/queryKeys.ts` — imported by **43** files
- `server/activity-log.ts` — imported by **38** files
- `server/db/stmt-cache.ts` — imported by **37** files
- `server/db/json-validation.ts` — imported by **36** files
- `shared/types/analytics.ts` — imported by **36** files
- `tests/integration/helpers.ts` — imported by **33** files
- `server/broadcast.ts` — imported by **31** files
- `server/data-dir.ts` — imported by **30** files
- `server/helpers.ts` — imported by **29** files
- `shared/types/content.ts` — imported by **29** files
- `server/openai-helpers.ts` — imported by **28** files
- `server/analytics-insights-store.ts` — imported by **26** files
- `server/workspace-data.ts` — imported by **26** files

## Import Map (who imports what)

- `server/workspace-intelligence.ts` ← `server/admin-chat-context.ts`, `server/aeo-page-review.ts`, `server/anomaly-detection.ts`, `server/churn-signals.ts`, `server/content-decay.ts` +134 more
- `server/logger.ts` ← `server/admin-chat-context.ts`, `server/aeo-page-review.ts`, `server/ai-deduplication.ts`, `server/alttext.ts`, `server/analytics-intelligence.ts` +126 more
- `server/workspaces.ts` ← `server/admin-chat-context.ts`, `server/admin-chat-context.ts`, `server/ai-context-check.ts`, `server/analytics-intelligence.ts`, `server/anomaly-detection.ts` +122 more
- `src/api/client.ts` ← `src/App.tsx`, `src/api/analytics.ts`, `src/api/content.ts`, `src/api/index.ts`, `src/api/intelligence.ts` +83 more
- `src/components/ui/index.ts` ← `src/components/AeoReview.tsx`, `src/components/AnalyticsAnnotations.tsx`, `src/components/AnalyticsHub.tsx`, `src/components/AnalyticsOverview.tsx`, `src/components/Annotations.tsx` +81 more
- `server/db/index.ts` ← `scripts/diagnose-h1.ts`, `server/activity-log.ts`, `server/analytics-annotations.ts`, `server/analytics-insights-store.ts`, `server/analytics-intelligence.ts` +70 more
- `server/auth.ts` ← `server/app.ts`, `server/middleware.ts`, `server/routes/aeo-review.ts`, `server/routes/annotations.ts`, `server/routes/anomalies.ts` +47 more
- `src/lib/queryKeys.ts` ← `src/components/AssetBrowser.tsx`, `src/components/ContentPipeline.tsx`, `src/components/KeywordStrategy.tsx`, `src/components/LlmsTxtGenerator.tsx`, `src/components/admin/ActionQueue.tsx` +38 more
- `server/activity-log.ts` ← `server/anomaly-detection.ts`, `server/churn-signals.ts`, `server/content-subscriptions.ts`, `server/feedback.ts`, `server/intelligence-crons.ts` +33 more
- `server/db/stmt-cache.ts` ← `server/activity-log.ts`, `server/analytics-annotations.ts`, `server/analytics-insights-store.ts`, `server/annotations.ts`, `server/anomaly-detection.ts` +32 more
