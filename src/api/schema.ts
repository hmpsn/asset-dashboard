// ── Schema-domain API endpoints ──────────────────────────────────
import { get, post, put, del, getSafe, getOptional } from './client';
import type { SchemaSitePlan, PageRoleAssignment, CanonicalEntity } from '../../shared/types/schema-plan';
import type { WholeSiteSchemaGraphValidationResult } from '../../shared/types/schema-validation';

const workspaceQuery = (workspaceId?: string) => workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
const appendWorkspaceQuery = (url: string, workspaceId?: string) =>
  workspaceId ? `${url}${url.includes('?') ? '&' : '?'}workspaceId=${encodeURIComponent(workspaceId)}` : url;

// ── Schema ──────────────────────────────────────────────────────
export const schema = {
  retract: (siteId: string, pageId: string, workspaceId?: string) =>
    del(appendWorkspaceQuery(`/api/webflow/schema-retract/${siteId}/${pageId}`, workspaceId)),
};

// ── Schema Validation ───────────────────────────────────────────
export interface SchemaValidationResult {
  status: 'valid' | 'warnings' | 'errors';
  richResults: string[];
  errors: Array<{ type: string; field: string; message: string }>;
  warnings: Array<{ type: string; field: string; message: string }>;
}

export interface SchemaValidationRecord {
  id: string;
  pageId: string;
  status: 'valid' | 'warnings' | 'errors';
  richResults: string[];
  errors: Array<{ type: string; message: string }>;
  warnings: Array<{ type: string; message: string }>;
  validatedAt: string;
}

export const schemaValidation = {
  validate: (siteId: string, body: { pageId: string; schema: Record<string, unknown> }, workspaceId?: string) =>
    post<SchemaValidationResult>(`/api/webflow/schema-validate/${siteId}${workspaceQuery(workspaceId)}`, body),

  getAll: (siteId: string, workspaceId?: string) =>
    getSafe<SchemaValidationRecord[]>(`/api/webflow/schema-validations/${siteId}${workspaceQuery(workspaceId)}`, []),

  get: (siteId: string, pageId: string, workspaceId?: string) =>
    getOptional<SchemaValidationRecord>(appendWorkspaceQuery(`/api/webflow/schema-validation/${siteId}?pageId=${encodeURIComponent(pageId)}`, workspaceId)),

  getGraph: (siteId: string, workspaceId?: string) =>
    getOptional<WholeSiteSchemaGraphValidationResult>(`/api/webflow/schema-graph-validation/${siteId}${workspaceQuery(workspaceId)}`),
};

// ── Schema Site Plan ────────────────────────────────────────────
export const schemaPlan = {
  get: (siteId: string, workspaceId?: string) =>
    getOptional<SchemaSitePlan>(`/api/webflow/schema-plan/${siteId}${workspaceQuery(workspaceId)}`),

  generate: (siteId: string, workspaceId?: string) =>
    post<SchemaSitePlan>(`/api/webflow/schema-plan/${siteId}${workspaceQuery(workspaceId)}`),

  update: (siteId: string, pageRoles: PageRoleAssignment[], canonicalEntities?: CanonicalEntity[], workspaceId?: string) =>
    put<SchemaSitePlan>(`/api/webflow/schema-plan/${siteId}${workspaceQuery(workspaceId)}`, { pageRoles, canonicalEntities }),

  sendToClient: (siteId: string, workspaceId?: string) =>
    post<{ plan: SchemaSitePlan }>(`/api/webflow/schema-plan/${siteId}/send-to-client${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`),

  activate: (siteId: string, workspaceId?: string) =>
    post<SchemaSitePlan>(`/api/webflow/schema-plan/${siteId}/activate${workspaceQuery(workspaceId)}`),

  retract: (siteId: string, workspaceId?: string) =>
    del(`/api/webflow/schema-plan/${siteId}${workspaceQuery(workspaceId)}`),
};

// ── Schema impact tracking ──────────────────────────────────────
export interface SchemaDeploymentImpact {
  change: {
    id: string;
    pageSlug: string;
    pageTitle: string;
    fields: string[];
    source: string;
    changedAt: string;
  };
  before: { clicks: number; impressions: number; ctr: number; position: number } | null;
  after: { clicks: number; impressions: number; ctr: number; position: number } | null;
  daysSinceChange: number;
  tooRecent: boolean;
}

export interface SchemaImpactData {
  totalDeployments: number;
  pagesWithData: number;
  tooRecent: number;
  avgClicksDelta: number | null;
  avgImpressionsDelta: number | null;
  avgCtrDelta: number | null;
  avgPositionDelta: number | null;
  deployments: SchemaDeploymentImpact[];
}

export const schemaImpact = {
  get: (wsId: string) =>
    get<SchemaImpactData>(`/api/schema-impact/${wsId}`),
};
