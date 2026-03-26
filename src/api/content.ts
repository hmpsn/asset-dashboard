// ── Content API (briefs, posts, content requests) ─────────────────
import { get, post, patch, put, del, getSafe, getOptional } from './client';
import type { ContentBrief, GeneratedPost, ContentTopicRequest, ContentTemplate, ContentMatrix, KeywordCandidate } from '../../shared/types/content';
import type { ClientContentRequest } from '../components/client/types';

export const contentBriefs = {
  list: (wsId: string) =>
    get<ContentBrief[]>(`/api/content-briefs/${wsId}`),

  generate: (wsId: string, body: Record<string, unknown>) =>
    post<ContentBrief>(`/api/content-briefs/${wsId}/generate`, body),

  update: (wsId: string, briefId: string, body: Record<string, unknown>) =>
    patch<ContentBrief>(`/api/content-briefs/${wsId}/${briefId}`, body),

  remove: (wsId: string, briefId: string) =>
    del(`/api/content-briefs/${wsId}/${briefId}`),

  validateKeyword: (wsId: string, keyword: string) =>
    post<{ keyword: string; valid: boolean; source: string; metrics: { volume: number; difficulty: number; cpc: number; validatedAt: string } | null; warnings?: string[]; message?: string }>(
      `/api/content-briefs/${wsId}/validate-keyword`, { keyword },
    ),

  validateKeywords: (wsId: string, keywords: string[]) =>
    post<{ results: { keyword: string; valid: boolean; source: string; metrics: { volume: number; difficulty: number; cpc: number; validatedAt: string } | null; warnings?: string[] }[]; message?: string }>(
      `/api/content-briefs/${wsId}/validate-keywords`, { keywords },
    ),

  regenerateOutline: (wsId: string, briefId: string, feedback?: string) =>
    post<ContentBrief>(`/api/content-briefs/${wsId}/${briefId}/regenerate-outline`, { feedback }),
};

export const contentPosts = {
  list: (wsId: string) =>
    get<GeneratedPost[]>(`/api/content-posts/${wsId}`),

  generate: (wsId: string, body: Record<string, unknown>) =>
    post<GeneratedPost>(`/api/content-posts/${wsId}/generate`, body),

  update: (wsId: string, postId: string, body: Record<string, unknown>) =>
    patch<GeneratedPost>(`/api/content-posts/${wsId}/${postId}`, body),

  remove: (wsId: string, postId: string) =>
    del(`/api/content-posts/${wsId}/${postId}`),

  getById: (wsId: string, postId: string) =>
    get<GeneratedPost>(`/api/content-posts/${wsId}/${postId}`),

  regenerateSection: (wsId: string, postId: string, body: Record<string, unknown>) =>
    post<GeneratedPost>(`/api/content-posts/${wsId}/${postId}/regenerate-section`, body),

  versions: (wsId: string, postId: string) =>
    getSafe<Array<{ id: string; createdAt: string; totalWordCount: number }>>(`/api/content-posts/${wsId}/${postId}/versions`, []),

  revertVersion: (wsId: string, postId: string, versionId: string) =>
    post<GeneratedPost>(`/api/content-posts/${wsId}/${postId}/versions/${versionId}/revert`),

  publishToWebflow: (wsId: string, postId: string, body?: { generateImage?: boolean }) =>
    post<{ success: boolean; itemId?: string; slug?: string; isUpdate?: boolean; error?: string; post?: unknown }>(
      `/api/content-posts/${wsId}/${postId}/publish-to-webflow`, body,
    ),

  aiReview: (wsId: string, postId: string) =>
    post<{ review: Record<string, { pass: boolean; reason: string }> }>(
      `/api/content-posts/${wsId}/${postId}/ai-review`,
    ),

  scoreVoice: (wsId: string, postId: string) =>
    post<GeneratedPost>(`/api/content-posts/${wsId}/${postId}/score-voice`, {}),
};

export const contentRequests = {
  list: (wsId: string) =>
    get<ContentTopicRequest[]>(`/api/content-requests/${wsId}`),

  create: (wsId: string, body: Record<string, unknown>) =>
    post<ContentTopicRequest>(`/api/content-requests/${wsId}`, body),

  update: (wsId: string, reqId: string, body: Record<string, unknown>) =>
    patch<ContentTopicRequest>(`/api/content-requests/${wsId}/${reqId}`, body),

  remove: (wsId: string, reqId: string) =>
    del(`/api/content-requests/${wsId}/${reqId}`),
};

// ── Public content endpoints (client portal) ────────────────────

export const publicContent = {
  requests: (wsId: string) =>
    getSafe<ClientContentRequest[]>(`/api/public/content-requests/${wsId}`, []),

  requestTopic: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/content-requests/${wsId}`, body),

  createRequest: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/content-request/${wsId}`, body),

  submitRequest: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/content-request/${wsId}/submit`, body),

  decline: (wsId: string, reqId: string, body?: Record<string, unknown>) =>
    post<unknown>(`/api/public/content-request/${wsId}/${reqId}/decline`, body),

  approve: (wsId: string, reqId: string) =>
    post<unknown>(`/api/public/content-request/${wsId}/${reqId}/approve`),

  requestChanges: (wsId: string, reqId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/content-request/${wsId}/${reqId}/request-changes`, body),

  comment: (wsId: string, reqId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/public/content-request/${wsId}/${reqId}/comment`, body),

  upgrade: (wsId: string, reqId: string) =>
    post<unknown>(`/api/public/content-request/${wsId}/${reqId}/upgrade`),

  briefPreview: (wsId: string, briefId: string) =>
    getOptional<unknown>(`/api/public/content-brief/${wsId}/${briefId}`),
};

// ── Content Templates (scalable content planning) ──────────────

export const contentTemplates = {
  list: (wsId: string) =>
    get<ContentTemplate[]>(`/api/content-templates/${wsId}`),

  getById: (wsId: string, templateId: string) =>
    get<ContentTemplate>(`/api/content-templates/${wsId}/${templateId}`),

  create: (wsId: string, body: Partial<ContentTemplate>) =>
    post<ContentTemplate>(`/api/content-templates/${wsId}`, body),

  update: (wsId: string, templateId: string, body: Partial<ContentTemplate>) =>
    put<ContentTemplate>(`/api/content-templates/${wsId}/${templateId}`, body),

  remove: (wsId: string, templateId: string) =>
    del(`/api/content-templates/${wsId}/${templateId}`),

  duplicate: (wsId: string, templateId: string, name?: string) =>
    post<ContentTemplate>(`/api/content-templates/${wsId}/${templateId}/duplicate`, { name }),
};

// ── Content Matrices (bulk content planning grids) ──────────────

export const contentMatrices = {
  list: (wsId: string) =>
    get<ContentMatrix[]>(`/api/content-matrices/${wsId}`),

  getById: (wsId: string, matrixId: string) =>
    get<ContentMatrix>(`/api/content-matrices/${wsId}/${matrixId}`),

  create: (wsId: string, body: { name: string; templateId: string; dimensions: ContentMatrix['dimensions']; urlPattern: string; keywordPattern: string }) =>
    post<ContentMatrix>(`/api/content-matrices/${wsId}`, body),

  update: (wsId: string, matrixId: string, body: Partial<Pick<ContentMatrix, 'name' | 'dimensions' | 'urlPattern' | 'keywordPattern' | 'cells'>>) =>
    put<ContentMatrix>(`/api/content-matrices/${wsId}/${matrixId}`, body),

  updateCell: (wsId: string, matrixId: string, cellId: string, body: Record<string, unknown>) =>
    patch<ContentMatrix>(`/api/content-matrices/${wsId}/${matrixId}/cells/${cellId}`, body),

  remove: (wsId: string, matrixId: string) =>
    del(`/api/content-matrices/${wsId}/${matrixId}`),

  recommendKeywords: (wsId: string, seedKeyword: string, opts?: { useAI?: boolean; maxCandidates?: number }) =>
    post<{ seedKeyword: string; candidates: KeywordCandidate[]; recommended: string | null; message?: string }>(
      `/api/content-matrices/${wsId}/recommend-keywords`,
      { seedKeyword, ...opts },
    ),

  recommendKeywordsForCell: (wsId: string, matrixId: string, cellId: string, opts?: { seedKeyword?: string; useAI?: boolean; maxCandidates?: number }) =>
    post<{ seedKeyword: string; candidates: KeywordCandidate[]; recommended: string | null; message?: string }>(
      `/api/content-matrices/${wsId}/${matrixId}/cells/${cellId}/recommend-keywords`,
      opts ?? {},
    ),

  getCannibalization: (wsId: string, matrixId: string) =>
    get<{ workspaceId: string; matrixId: string; conflicts: unknown[]; checkedAt: string; summary: { high: number; medium: number; low: number; total: number } }>(
      `/api/content-matrices/${wsId}/${matrixId}/cannibalization`,
    ),

  checkKeywordCannibalization: (wsId: string, keyword: string) =>
    post<{ keyword: string; conflicts: unknown[]; total: number }>(
      `/api/content-matrices/${wsId}/check-cannibalization`,
      { keyword },
    ),

  exportMatricesCsv: (wsId: string) =>
    `/api/export/${wsId}/matrices?format=csv`,

  exportMatricesJson: (wsId: string) =>
    `/api/export/${wsId}/matrices?format=json`,

  exportTemplatesCsv: (wsId: string) =>
    `/api/export/${wsId}/templates?format=csv`,

  exportTemplatesJson: (wsId: string) =>
    `/api/export/${wsId}/templates?format=json`,
};

// ── Content Plan Review (client-facing + admin) ─────────────────

export const contentPlanReview = {
  // Public (client portal)
  getPlans: (wsId: string) =>
    get<unknown[]>(`/api/public/content-plan/${wsId}`),

  getPlan: (wsId: string, matrixId: string) =>
    get<unknown>(`/api/public/content-plan/${wsId}/${matrixId}`),

  flagCell: (wsId: string, matrixId: string, cellId: string, comment: string) =>
    post<{ ok: boolean }>(`/api/public/content-plan/${wsId}/${matrixId}/cells/${cellId}/flag`, { comment }),

  // Admin
  sendTemplateReview: (wsId: string, matrixId: string) =>
    post<{ batchId: string; batch: unknown }>(`/api/content-plan/${wsId}/${matrixId}/send-template-review`, {}),

  sendSamples: (wsId: string, matrixId: string, cellIds: string[]) =>
    post<{ batchId: string; batch: unknown; cellsSent: number }>(`/api/content-plan/${wsId}/${matrixId}/send-samples`, { cellIds }),

  batchApprove: (wsId: string, matrixId: string) =>
    post<{ ok: boolean; approvedCount: number; totalCells: number }>(`/api/content-plan/${wsId}/${matrixId}/batch-approve`, {}),
};

// ── Site Architecture Planner ────────────────────────────────────

export const siteArchitecture = {
  get: (wsId: string) =>
    get<unknown>(`/api/site-architecture/${wsId}`),
  schemaCoverage: (wsId: string) =>
    get<{
      totalExisting: number;
      withSchema: number;
      withoutSchema: number;
      coveragePct: number;
      snapshotDate: string | null;
      hasPlan: boolean;
      hasLinkData: boolean;
      pages: Array<{
        path: string;
        name: string;
        hasSchema: boolean;
        schemaTypes: string[];
        role: string | null;
        depth: number;
        pageType: string | null;
        inboundLinks: number | null;
        outboundLinks: number | null;
        isOrphan: boolean | null;
        linkScore: number | null;
        priority: 'critical' | 'high' | 'medium' | 'low' | 'done';
      }>;
      priorityQueue: Array<{
        path: string;
        name: string;
        hasSchema: boolean;
        schemaTypes: string[];
        priority: 'critical' | 'high' | 'medium' | 'low' | 'done';
        inboundLinks: number | null;
        isOrphan: boolean | null;
        linkScore: number | null;
      }>;
    }>(`/api/site-architecture/${wsId}/schema-coverage`),
};

// ── LLMs.txt Generator ──────────────────────────────────────────

export const llmsTxt = {
  generate: (wsId: string) =>
    get<{ content: string; pageCount: number; generatedAt: string }>(`/api/llms-txt/${wsId}`),

  downloadUrl: (wsId: string) =>
    `/api/llms-txt/${wsId}/download`,
};

// ── Content decay ───────────────────────────────────────────────
export const contentDecay = {
  get: (wsId: string) =>
    get<unknown>(`/api/content-decay/${wsId}`),

  analyze: (wsId: string) =>
    post<unknown>(`/api/content-decay/${wsId}/analyze`),

  recommendations: (wsId: string, body: Record<string, unknown>) =>
    post<unknown>(`/api/content-decay/${wsId}/recommendations`, body),
};
