// shared/types/copy-pipeline.ts
// Full Copy Pipeline shared types (Phase 3)

// ── Status types ──

export type CopySectionStatus =
  | 'pending'
  | 'draft'
  | 'client_review'
  | 'approved'
  | 'revision_requested';

export type BatchMode = 'review_inbox' | 'iterative';

export type ExportFormat = 'webflow_cms' | 'csv' | 'copy_deck';

export type ExportScope = 'all' | 'selected' | 'single';

export type IntelligencePatternType = 'terminology' | 'tone' | 'structure' | 'keyword_usage';

// ── Embedded JSON column types ──

export interface QualityFlag {
  type: 'forbidden_phrase' | 'keyword_stuffing' | 'word_count_violation' | 'missing_element' | 'guardrail_violation';
  message: string;
  severity: 'error' | 'warning';
}

export interface SteeringEntry {
  type: 'note' | 'highlight' | 'summary';
  note: string;
  highlight?: string;
  resultVersion: number;
  timestamp: string;
}

export interface ClientSuggestion {
  originalText: string;
  suggestedText: string;
  status: 'pending' | 'accepted' | 'rejected' | 'modified';
  reviewNote?: string;
  timestamp: string;
}

export interface BatchProgress {
  total: number;
  generated: number;
  reviewed: number;
  approved: number;
}

// ── Row types (mapped from DB) ──

export interface CopySection {
  id: string;
  workspaceId: string;
  entryId: string;
  sectionPlanItemId: string;
  generatedCopy: string | null;
  status: CopySectionStatus;
  aiAnnotation: string | null;
  aiReasoning: string | null;
  steeringHistory: SteeringEntry[];
  clientSuggestions: ClientSuggestion[] | null;
  qualityFlags: QualityFlag[] | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CopyMetadata {
  id: string;
  workspaceId: string;
  entryId: string;
  seoTitle: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  status: CopySectionStatus;
  steeringHistory: SteeringEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface CopyIntelligencePattern {
  id: string;
  workspaceId: string;
  patternType: IntelligencePatternType;
  pattern: string;
  source: string | null;
  frequency: number;
  active: boolean;
  createdAt: string;
}

export interface BatchJob {
  id: string;
  workspaceId: string;
  blueprintId: string;
  mode: BatchMode;
  entryIds: string[];
  batchSize: number;
  status: 'pending' | 'running' | 'paused' | 'complete' | 'failed';
  progress: BatchProgress;
  accumulatedSteering: string[];
  createdAt: string;
  updatedAt: string;
}

// ── AI output shapes ──

export interface GeneratedSectionCopy {
  sectionPlanItemId: string;
  copy: string;
  annotation: string;
  reasoning: string;
}

export interface GeneratedPageCopy {
  sections: GeneratedSectionCopy[];
  seoTitle: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
}

// ── Export types ──

export interface ExportRequest {
  format: ExportFormat;
  scope: ExportScope;
  entryIds?: string[];
  entryId?: string;
  webflowSiteId?: string;
  docFormat?: 'google' | 'word';
}

export interface ExportResult {
  success: boolean;
  format: ExportFormat;
  filename?: string;
  content?: string;
  url?: string;
  error?: string;
}

// ── Derived status ──

export interface EntryCopyStatus {
  entryId: string;
  totalSections: number;
  pendingSections: number;
  draftSections: number;
  clientReviewSections: number;
  approvedSections: number;
  revisionSections: number;
  overallStatus: CopySectionStatus;
  approvalPercentage: number;
}
