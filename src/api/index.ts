// ── API barrel export ──────────────────────────────────────────────
export { ApiError, get, post, patch, put, del, postForm, getOptional, getSafe } from './client';
export { gsc, ga4, gscAdmin } from './analytics';
export { workspaces, publicWorkspaces } from './workspaces';
export { contentBriefs, contentPosts, contentRequests, publicContent, contentDecay, contentTemplates, contentMatrices } from './content';
export { audit, auditSchedules, reports, schema, keywords, rankTracking, backlinks, webflow, contentPerformance, aeoReview, competitor, seoChangeTracker, pageWeight } from './seo';
export {
  requests, publicRequests, approvals, activity, annotations, anomalies, churnSignals,
  chat, recommendations, upload, settings, salesReport, redirects,
  stripe, auth, keywordFeedback, trackedKeywords, businessPriorities,
} from './misc';
export {
  jobs, roadmap, features, notifications, workspaceOverview,
  workspaceHome, workspaceBadges, integrationHealth, observability,
} from './platform';
export { meetingBriefApi } from './meetingBrief';
export { briefingApi } from './briefing';
export { diagnostics } from './diagnostics.js';
export { clientActions } from './clientActions';
