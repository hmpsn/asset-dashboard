import { z } from 'zod';

export const MCP_OPERATOR_BRIEF_LIMITS = {
  defaultListLimit: 10,
  maxListLimit: 25,
  maxDecisionLabelBytes: 160,
  maxDrillDownIdsPerWorkspace: 9,
} as const;

export const MCP_OPERATOR_SOURCE_TYPES = [
  'approval_item',
  'client_request',
  'client_action',
  'insight',
  'churn_signal',
] as const;

export const MCP_PORTFOLIO_REASON_CODES = [
  'pending_request',
  'pending_approval',
  'pending_client_action',
  'no_pending_work',
] as const;

export const MCP_DECISION_BLOCKER_REASON_CODES = [
  'critical_insight',
  'warning_insight',
  'site_health_low_score',
  'site_health_dead_links',
  'site_health_schema_errors',
  'site_health_orphan_pages',
  'site_health_anomaly',
  'content_pending_requests',
  'content_pending_review',
  'client_risk_critical',
  'client_risk_warning',
  'data_unavailable',
] as const;

export const MCP_NEXT_SAFE_ACTION_CODES = [
  'review_pending_decision',
  'inspect_critical_insight',
  'inspect_client_risk',
  'inspect_site_health',
  'review_content_queue',
  'wait_for_running_job',
  'inspect_data_availability',
  'no_action_required',
] as const;

const boundedLimitSchema = z.number().int().min(1)
  .max(MCP_OPERATOR_BRIEF_LIMITS.maxListLimit);
const workspaceIdSchema = z.string().trim().min(1).max(512);
const nonnegativeIntegerSchema = z.number().int().nonnegative();
const nullableNumberSchema = z.number().finite().nullable();
const nullableStringSchema = z.string().nullable();

export const getPortfolioBriefInputSchema = z.object({
  limit: boundedLimitSchema.default(MCP_OPERATOR_BRIEF_LIMITS.defaultListLimit),
}).strict();

export const getWorkspaceDecisionBriefInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  queue_limit: boundedLimitSchema.default(MCP_OPERATOR_BRIEF_LIMITS.defaultListLimit),
}).strict();

export const getClientViewInputSchema = z.object({
  workspace_id: workspaceIdSchema,
}).strict();

export const mcpOperatorSourceRefSchema = z.object({
  source_type: z.enum(MCP_OPERATOR_SOURCE_TYPES),
  source_id: z.string().min(1),
  parent_id: nullableStringSchema.optional(),
}).strict();

const pendingCountsSchema = z.object({
  approvals: nonnegativeIntegerSchema,
  requests: nonnegativeIntegerSchema,
  client_actions: nonnegativeIntegerSchema,
  total: nonnegativeIntegerSchema,
}).strict();

const portfolioWorkspaceSchema = z.object({
  attention_rank: z.number().int().positive(),
  workspace_id: z.string().min(1),
  name: z.string(),
  effective_tier: z.enum(['free', 'growth', 'premium']),
  live_domain: nullableStringSchema,
  pending: pendingCountsSchema,
  reason_codes: z.array(z.enum(MCP_PORTFOLIO_REASON_CODES)).min(1).max(4),
  drill_down_ids: z.array(mcpOperatorSourceRefSchema)
    .max(MCP_OPERATOR_BRIEF_LIMITS.maxDrillDownIdsPerWorkspace),
}).strict();

export const portfolioBriefDataSchema = z.object({
  limit: boundedLimitSchema,
  returned: nonnegativeIntegerSchema,
  total_workspaces: nonnegativeIntegerSchema,
  has_more: z.boolean(),
  workspaces: z.array(portfolioWorkspaceSchema)
    .max(MCP_OPERATOR_BRIEF_LIMITS.maxListLimit),
}).strict();

export const portfolioBriefOutputSchema = z.object({
  data: portfolioBriefDataSchema,
}).strict();

const intelligenceSliceNameSchema = z.enum([
  'insights',
  'contentPipeline',
  'siteHealth',
  'clientSignals',
  'operational',
]);

const pendingDecisionSchema = z.object({
  source: mcpOperatorSourceRefSchema,
  label: z.string().max(MCP_OPERATOR_BRIEF_LIMITS.maxDecisionLabelBytes),
  priority: z.enum(['urgent', 'high', 'medium', 'low']),
  created_at: z.string(),
}).strict();

const blockerSchema = z.object({
  reason_code: z.enum(MCP_DECISION_BLOCKER_REASON_CODES),
  severity: z.enum(['critical', 'high', 'medium']),
  count: nonnegativeIntegerSchema,
  source_refs: z.array(mcpOperatorSourceRefSchema)
    .max(MCP_OPERATOR_BRIEF_LIMITS.maxListLimit),
}).strict();

const clientRiskSignalSchema = z.object({
  source: mcpOperatorSourceRefSchema,
  signal_type: z.string(),
  severity: z.enum(['critical', 'warning', 'info']),
  detected_at: z.string(),
}).strict();

const nextSafeActionSchema = z.object({
  action_code: z.enum(MCP_NEXT_SAFE_ACTION_CODES),
  reason_code: z.string(),
  source_refs: z.array(mcpOperatorSourceRefSchema).max(3),
}).strict();

export const workspaceDecisionBriefDataSchema = z.object({
  workspace: z.object({
    workspace_id: z.string().min(1),
    name: z.string(),
    effective_tier: z.enum(['free', 'growth', 'premium']),
  }).strict(),
  queue_limit: boundedLimitSchema,
  slice_availability: z.object({
    requested: z.array(intelligenceSliceNameSchema).length(5),
    available: z.array(intelligenceSliceNameSchema).max(5),
    unavailable: z.array(intelligenceSliceNameSchema).max(5),
  }).strict(),
  blockers: z.array(blockerSchema).max(MCP_OPERATOR_BRIEF_LIMITS.maxListLimit),
  pending_decisions: z.object({
    total: nonnegativeIntegerSchema,
    returned: nonnegativeIntegerSchema,
    has_more: z.boolean(),
    items: z.array(pendingDecisionSchema).max(MCP_OPERATOR_BRIEF_LIMITS.maxListLimit),
  }).strict(),
  client_risk_signals: z.object({
    total: nonnegativeIntegerSchema,
    returned: nonnegativeIntegerSchema,
    has_more: z.boolean(),
    items: z.array(clientRiskSignalSchema).max(MCP_OPERATOR_BRIEF_LIMITS.maxListLimit),
  }).strict(),
  next_safe_actions: z.array(nextSafeActionSchema).min(1).max(3),
}).strict();

export const workspaceDecisionBriefOutputSchema = z.object({
  data: workspaceDecisionBriefDataSchema,
}).strict();

const clientInsightsSummarySchema = z.object({
  total: nonnegativeIntegerSchema,
  highPriority: nonnegativeIntegerSchema,
  mediumPriority: nonnegativeIntegerSchema,
  topInsights: z.array(z.object({ title: z.string(), type: z.string() }).strict()).max(3),
}).strict();

const clientPipelineStatusSchema = z.object({
  briefs: z.object({ total: nonnegativeIntegerSchema, inProgress: nonnegativeIntegerSchema }).strict(),
  posts: z.object({ total: nonnegativeIntegerSchema, inProgress: nonnegativeIntegerSchema }).strict(),
  pendingApprovals: nonnegativeIntegerSchema,
}).strict();

const clientCompositeBreakdownSchema = z.object({
  rows: z.array(z.object({
    id: z.enum(['retention', 'roi', 'engagement']),
    label: z.string(),
    score: z.number().finite(),
    weight: z.number().finite(),
    description: z.string(),
  }).strict()),
}).strict();

const weCalledItSchema = z.object({
  actionId: z.string(),
  prediction: z.string(),
  outcome: z.string(),
  score: z.string(),
  pageUrl: z.string(),
  measuredAt: z.string(),
}).strict();

export const clientViewDataSchema = z.object({
  workspaceId: z.string(),
  assembledAt: z.string(),
  tier: z.enum(['free', 'growth', 'premium']),
  insightsSummary: clientInsightsSummarySchema.nullable(),
  pipelineStatus: clientPipelineStatusSchema.nullable(),
  learningHighlights: z.object({
    overallWinRate: z.number().finite(),
    topActionType: nullableStringSchema,
    recentWins: nonnegativeIntegerSchema,
  }).strict().nullable().optional(),
  rankTrackingSummary: z.object({
    trackedKeywords: nonnegativeIntegerSchema,
    avgPosition: nullableNumberSchema,
    positionChanges: z.object({
      improved: nonnegativeIntegerSchema,
      declined: nonnegativeIntegerSchema,
      stable: nonnegativeIntegerSchema,
    }).strict(),
  }).strict().nullable().optional(),
  serpOpportunities: nullableNumberSchema.optional(),
  compositeHealthScore: nullableNumberSchema.optional(),
  compositeHealthBreakdown: clientCompositeBreakdownSchema.nullable().optional(),
  keywordFeedbackSummary: z.object({
    approvedCount: nonnegativeIntegerSchema,
    rejectedCount: nonnegativeIntegerSchema,
    approveRate: z.number().finite(),
    approvedSamples: z.array(z.string()).max(3),
    rejectedSamples: z.array(z.string()).max(3),
    rejectionReasons: z.array(z.string()).max(3),
  }).strict().nullable().optional(),
  weCalledIt: z.array(weCalledItSchema).optional(),
  copyPipelineStatus: z.object({
    totalSections: nonnegativeIntegerSchema,
    approvedSections: nonnegativeIntegerSchema,
    inReviewSections: nonnegativeIntegerSchema,
    approvalRate: z.number().finite(),
  }).strict().nullable().optional(),
  siteHealthSummary: z.object({
    auditScore: nullableNumberSchema,
    auditScoreDelta: nullableNumberSchema,
    cwvPassRatePct: nullableNumberSchema,
    deadLinks: nonnegativeIntegerSchema,
  }).strict().nullable().optional(),
  contentDecayAlerts: z.array(z.object({
    pageUrl: z.string(),
    clickDrop: z.number().finite(),
    detectedAt: z.string(),
    hasRefreshBrief: z.boolean(),
  }).strict()).max(10).nullable().optional(),
}).strict();

export const clientViewOutputSchema = z.object({
  data: clientViewDataSchema,
}).strict();

export type McpOperatorSourceRef = z.infer<typeof mcpOperatorSourceRefSchema>;
export type PortfolioBriefData = z.infer<typeof portfolioBriefDataSchema>;
export type WorkspaceDecisionBriefData = z.infer<typeof workspaceDecisionBriefDataSchema>;
export type ClientViewData = z.infer<typeof clientViewDataSchema>;
