// @ds-rebuilt
import type { SeoEditorWriteTarget } from '../../../shared/types/seo-editor-write-target';
import type { SeoEditState, SeoEditorPage, SeoRecommendation, SeoVariationSet } from '../editor/seoEditorTypes';
import type { ApprovalMapItem, CmsCollection, CmsItem } from '../cms-editor/cmsEditorModel';
import type { PageEditStatus } from '../ui/statusConfig';

export interface SeoEditorProjectedMetrics {
  optimizationScore?: number | null;
  rank?: number | null;
  traffic?: number | null;
  lastEditedAt?: string | null;
}

export interface SeoEditorKeywordAssignment {
  primaryKeyword?: string;
  secondaryKeywords: string[];
}

export interface SeoEditorSurfaceRow {
  id: string;
  target: SeoEditorWriteTarget;
  staticPage?: SeoEditorPage;
  cmsCollection?: CmsCollection;
  cmsItem?: CmsItem;
  approvalHistory?: ApprovalMapItem[];
  edit?: SeoEditState;
  cmsEdit?: Record<string, string>;
  pageState?: { status?: PageEditStatus | string | null };
  recommendations: SeoRecommendation[];
  keywordAssignment?: SeoEditorKeywordAssignment;
  metrics: SeoEditorProjectedMetrics;
  dirty: boolean;
  missingTitle: boolean;
  missingDescription: boolean;
}

export interface StaticSeoWorkflowState {
  edits: Record<string, SeoEditState>;
  saving: Set<string>;
  saved: Set<string>;
  draftSaving: Set<string>;
  draftSaved: Set<string>;
  aiLoading: Record<string, string>;
  errorStates: Record<string, { type: string; message: string }>;
  analyzing: Set<string>;
  variations: Record<string, SeoVariationSet>;
  analyzedPages: Set<string>;
  approvalSelected: Set<string>;
  sendingApproval: boolean;
  approvalSent: boolean;
  sendingPage: Set<string>;
  sentPage: Set<string>;
  updateField: (pageId: string, field: 'seoTitle' | 'seoDescription', value: string) => void;
  saveDraft: (pageId: string) => Promise<void>;
  savePage: (pageId: string) => Promise<void>;
  savePageTitle: (pageId: string, title: string) => Promise<void>;
  aiRewrite: (pageId: string, field: 'title' | 'description' | 'both') => Promise<void>;
  analyzePage: (pageId: string) => Promise<void>;
  toggleApprovalSelect: (pageId: string) => void;
  selectAllForApproval: (ids?: string[]) => void;
  sendPageToClient: (pageId: string) => Promise<void>;
  sendForApproval: () => Promise<void>;
  clearPageTracking?: (pageId: string) => Promise<void>;
  clearVariations: (pageId: string) => void;
}

export interface StaticSeoBulkWorkflowState {
  bulkFixing: boolean;
  bulkResults: string | null;
  bulkAnalyzeProgress: { done: number; total: number } | null;
  bulkMode: string;
  bulkField: 'title' | 'description';
  patternAction: 'append' | 'prepend';
  patternText: string;
  bulkPreview: Array<{ pageId: string; oldValue: string; newValue: string }>;
  bulkProgress: { done: number; total: number };
  bulkSource: 'pattern' | 'ai';
  missingTitles: number;
  missingDescs: number;
  setBulkMode: (mode: 'idle' | 'pattern' | 'rewrite-preview' | 'rewriting') => void;
  setBulkField: (field: 'title' | 'description') => void;
  setPatternAction: (action: 'append' | 'prepend') => void;
  setPatternText: (value: string) => void;
  setBulkPreview: (items: Array<{ pageId: string; oldValue: string; newValue: string }>) => void;
  handleBulkFix: (field: 'title' | 'description') => Promise<void>;
  analyzeAllPages: () => Promise<void>;
  previewPattern: () => void;
  applyPattern: () => Promise<void>;
  bulkAiRewrite: (field: 'title' | 'description' | 'both') => Promise<void>;
  applyBulkRewrite: () => Promise<void>;
  cancelAnalyze: () => Promise<void>;
  cancelRewrite: () => Promise<void>;
}

export interface CmsSeoWorkflowState {
  edits: Record<string, Record<string, string>>;
  dirty: Set<string>;
  saved: Set<string>;
  saving: Set<string>;
  errors: Record<string, string>;
  variations: Record<string, { fieldSlug: string; options: string[]; descOptions?: string[] }>;
  aiLoading: Record<string, boolean>;
  aiError: string | null;
  approvalSelected: Set<string>;
  sendingApproval: boolean;
  approvalSent: boolean;
  approvalError: { type: 'validation' | 'network'; message: string } | null;
  publishing: Set<string>;
  published: Set<string>;
  bulkMode: 'idle' | 'rewriting';
  bulkProgress: { done: number; total: number };
  bulkResults: string | null;
  updateField: (itemId: string, fieldSlug: string, value: string) => void;
  saveItem: (collectionId: string, itemId: string) => Promise<void>;
  publishCollection: (collectionId: string) => Promise<void>;
  aiRewrite: (collectionId: string, itemId: string, fieldSlug: string) => Promise<boolean>;
  aiRewriteBoth: (collectionId: string, itemId: string, titleSlug: string, descSlug: string) => Promise<boolean>;
  applySingleVariation: (itemId: string, fieldSlug: string, value: string) => void;
  applyPairedVariation: (itemId: string, titleSlug: string, descSlug: string, titleValue: string, descValue: string) => void;
  toggleApprovalItem: (itemId: string) => void;
  toggleSelectAllInCollection: (itemIds: string[]) => void;
  sendForApproval: (note?: string) => Promise<void>;
  bulkAiRewrite: (targetField: 'name' | 'title' | 'description' | 'all') => Promise<void>;
}
