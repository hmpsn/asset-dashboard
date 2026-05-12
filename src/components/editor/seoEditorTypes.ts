import type { PageMeta } from '../../hooks/admin/useSeoEditor.js';

export type SeoEditorPage = PageMeta;

export interface SeoEditState {
  seoTitle: string;
  seoDescription: string;
  dirty: boolean;
}

export interface SeoRecommendation {
  id: string;
  type: string;
  title: string;
  insight: string;
  trafficAtRisk: number;
  estimatedGain: string;
  priority: string;
}

export interface SeoPageState {
  status?: string;
}

export interface SeoVariationSet {
  field: string;
  options: string[];
  descOptions?: string[];
}

export type SeoBulkMode = 'idle' | 'pattern' | 'rewrite-preview' | 'rewriting';
