// shared/types/page-strategy.ts

// ═══ SECTION PLAN ═══

export type SectionType =
  | 'hero' | 'problem' | 'solution' | 'social-proof' | 'process'
  | 'faq' | 'cta' | 'about-team' | 'testimonials' | 'features-benefits'
  | 'pricing' | 'gallery' | 'stats' | 'content-body' | 'contact-form'
  | 'location-info' | 'related-resources' | 'custom';

export type NarrativeRole =
  | 'hook' | 'problem' | 'guide' | 'plan' | 'call-to-action'
  | 'failure-stakes' | 'success-transformation' | 'authority'
  | 'objection-handling' | 'custom';

export interface SectionPlanItem {
  id: string;
  sectionType: SectionType;
  narrativeRole?: NarrativeRole;
  brandNote?: string;
  seoNote?: string;
  wordCountTarget: number;
  order: number;
}

// ═══ BLUEPRINT ENTRY ═══

// SPEC ADDENDUM §2: Do NOT create a separate BlueprintPageType.
// Import ContentPageType from content.ts and use it everywhere.
// Task 2 Step 2 extends ContentPageType with the new values.
import type { ContentPageType } from './content.js';

// Re-export for convenience — all blueprint code uses ContentPageType
export type { ContentPageType as BlueprintPageType };

export type EntryScope = 'included' | 'recommended';
export type KeywordSource = 'ai_suggested' | 'semrush' | 'manual';

export interface BlueprintEntry {
  id: string;
  blueprintId: string;
  name: string;
  pageType: ContentPageType;
  scope: EntryScope;
  sortOrder: number;
  isCollection: boolean;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  keywordSource?: KeywordSource;
  sectionPlan: SectionPlanItem[];
  templateId?: string;
  matrixId?: string;
  briefId?: string;   // Populated by Phase 3 auto-brief generation
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ═══ SITE BLUEPRINT ═══

export type BlueprintStatus = 'draft' | 'active' | 'archived';

export interface SiteBlueprint {
  id: string;
  workspaceId: string;
  name: string;
  version: number;
  status: BlueprintStatus;
  brandscriptId?: string;
  industryType?: string;
  generationInputs?: BlueprintGenerationInput;
  notes?: string;
  entries?: BlueprintEntry[];
  createdAt: string;
  updatedAt: string;
}

// ═══ BLUEPRINT VERSION ═══

export interface BlueprintVersion {
  id: string;
  blueprintId: string;
  version: number;
  snapshot: {
    blueprint: Omit<SiteBlueprint, 'entries'>;
    entries: BlueprintEntry[];
  };
  changeNotes?: string;
  createdAt: string;
}

// ═══ GENERATION ═══

export interface BlueprintGenerationInput {
  brandscriptId?: string;
  industryType: string;
  domain?: string;
  targetPageCount?: number;
  includeContentPages?: boolean;
  includeLocationPages?: boolean;
  locationCount?: number;
}

export interface GeneratedBlueprintEntry {
  name: string;
  pageType: ContentPageType;
  scope: EntryScope;
  isCollection: boolean;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  sectionPlan: Omit<SectionPlanItem, 'id'>[];
  rationale: string;
}
