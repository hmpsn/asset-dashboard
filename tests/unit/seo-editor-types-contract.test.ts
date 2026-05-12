import { describe, expect, it } from 'vitest';
import type { PageMeta } from '../../src/hooks/admin/useSeoEditor.js';
import type {
  SeoBulkMode,
  SeoEditState,
  SeoEditorPage,
  SeoPageState,
  SeoRecommendation,
  SeoVariationSet,
} from '../../src/components/editor/seoEditorTypes.js';

describe('seoEditorTypes contract', () => {
  it('SeoEditorPage stays assignable to PageMeta', () => {
    const page: SeoEditorPage = {
      id: 'page-about',
      title: 'About',
      slug: 'about',
      source: 'static',
      seo: { title: 'About Us', description: 'Learn about us' },
    };
    const asPageMeta: PageMeta = page;

    expect(asPageMeta.id).toBe('page-about');
    expect(asPageMeta.source).toBe('static');
  });

  it('SeoEditState, SeoPageState, and SeoVariationSet keep expected fields', () => {
    const edit: SeoEditState = { seoTitle: 'Title', seoDescription: 'Description', dirty: true };
    const pageState: SeoPageState = { status: 'pending' };
    const variations: SeoVariationSet = { field: 'title', options: ['A', 'B'], descOptions: ['C'] };

    expect(edit.dirty).toBe(true);
    expect(pageState.status).toBe('pending');
    expect(variations.options).toHaveLength(2);
  });

  it('SeoRecommendation and SeoBulkMode preserve literal contracts', () => {
    const recommendation: SeoRecommendation = {
      id: 'rec-1',
      type: 'seo',
      title: 'Improve title',
      insight: 'Current title is too short',
      trafficAtRisk: 42,
      estimatedGain: '+10%',
      priority: 'high',
    };
    const modes: SeoBulkMode[] = ['idle', 'pattern', 'rewrite-preview', 'rewriting'];

    expect(recommendation.id).toBe('rec-1');
    expect(modes).toHaveLength(4);
  });
});
