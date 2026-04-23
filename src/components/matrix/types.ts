import type { ContentPageType, TemplateSection } from '../../../shared/types/content';

export type { TemplateSection };

export interface ContentTemplate {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  pageType: ContentPageType;
  variables: TemplateVariable[];
  sections: TemplateSection[];
  urlPattern: string;
  keywordPattern: string;
  titlePattern?: string;
  metaDescPattern?: string;
  cmsFieldMap?: Record<string, string>;
  toneAndStyle?: string;
  schemaTypes?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVariable {
  name: string;
  label: string;
  description?: string;
}

export interface ContentMatrix {
  id: string;
  workspaceId: string;
  name: string;
  templateId: string;
  dimensions: MatrixDimension[];
  urlPattern: string;
  keywordPattern: string;
  cells: MatrixCell[];
  stats: {
    total: number;
    planned: number;
    briefGenerated: number;
    drafted: number;
    reviewed: number;
    published: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MatrixDimension {
  variableName: string;
  label?: string;
  values: string[];
}

export type MatrixCellStatus = 'planned' | 'keyword_validated' | 'brief_generated' | 'review' | 'approved' | 'draft' | 'published';

export interface StatusHistoryEntry {
  from: MatrixCellStatus;
  to: MatrixCellStatus;
  at: string;
}

export interface MatrixCell {
  id: string;
  variableValues: Record<string, string>;
  targetKeyword: string;
  customKeyword?: string;
  plannedUrl: string;
  briefId?: string;
  postId?: string;
  status: MatrixCellStatus;
  statusHistory?: StatusHistoryEntry[];
  keywordValidation?: {
    volume: number;
    difficulty: number;
    cpc: number;
    validatedAt: string;
  };
  keywordCandidates?: KeywordCandidate[];
  recommendedKeyword?: string;
  clientFlag?: string;
  clientFlaggedAt?: string;
  expectedSchemaTypes?: string[];
}

export interface KeywordCandidate {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  source: 'pattern' | 'semrush_related' | 'ai_suggested' | 'gsc';
  isRecommended: boolean;
}
