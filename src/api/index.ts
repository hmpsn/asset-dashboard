// ── API barrel export ──────────────────────────────────────────────
export { ApiError, get, post, patch, put, del, postForm, getOptional, getSafe } from './client';
export { gsc, ga4, gscAdmin } from './analytics';
export { workspaces, publicWorkspaces } from './workspaces';
export { contentBriefs, contentPosts, contentRequests, publicContent, contentDecay, contentTemplates, contentMatrices } from './content';
export { audit, auditSchedules, reports, schema, keywords, rankTracking, webflow, contentPerformance, aeoReview, competitor, seoChangeTracker, pageWeight } from './seo';
export { stripe, payments, workOrders, pricing } from './payments';
export { auth, clientAuth, chatUsage, roi } from './auth';
export {
  requests, publicRequests, approvals, activity, annotations, anomalies, churnSignals,
  jobs, chat, roadmap, recommendations, feedback, notifications, upload, settings,
  salesReport, redirects,
} from './misc';
