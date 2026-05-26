import { describe, it, expect } from 'vitest';
import {
  researchKeywordsInputSchema,
  addKeywordToStrategyInputSchema,
  prepareBriefContextInputSchema,
  saveBriefInputSchema,
  preparePostContextInputSchema,
  savePostInputSchema,
  sendToClientInputSchema,
  startKeywordStrategyGenerationInputSchema,
  startSeoAuditInputSchema,
  startLocalSeoRefreshInputSchema,
  layoutSchema,
  typedOutlineSchema,
} from '../../shared/types/mcp-action-schemas.js';

describe('mcp-action-schemas', () => {
  describe('researchKeywordsInputSchema', () => {
    it('accepts a single term', () => {
      expect(researchKeywordsInputSchema.safeParse({ workspace_id: 'ws-1', terms: ['solo crm'] }).success).toBe(true);
    });
    it('accepts multiple terms', () => {
      expect(researchKeywordsInputSchema.safeParse({ workspace_id: 'ws-1', terms: ['a', 'b', 'c'] }).success).toBe(true);
    });
    it('rejects empty terms array', () => {
      expect(researchKeywordsInputSchema.safeParse({ workspace_id: 'ws-1', terms: [] }).success).toBe(false);
    });
    it('rejects missing workspace_id', () => {
      expect(researchKeywordsInputSchema.safeParse({ terms: ['x'] }).success).toBe(false);
    });
  });

  describe('addKeywordToStrategyInputSchema', () => {
    it('accepts existing_page target with research_handle', () => {
      expect(addKeywordToStrategyInputSchema.safeParse({
        workspace_id: 'ws-1',
        research_handle: `keyword-research_${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`,
        target: { kind: 'existing_page', page_url: 'https://example.com/blog/x' },
      }).success).toBe(true);
    });
    it('accepts new_page target with raw term', () => {
      expect(addKeywordToStrategyInputSchema.safeParse({
        workspace_id: 'ws-1',
        term: 'solo crm',
        target: { kind: 'new_page', topic: 'Best CRMs', intent: 'commercial' },
      }).success).toBe(true);
    });
    it('rejects neither research_handle nor term', () => {
      expect(addKeywordToStrategyInputSchema.safeParse({
        workspace_id: 'ws-1',
        target: { kind: 'new_page', topic: 'x' },
      }).success).toBe(false);
    });
  });

  describe('layoutSchema', () => {
    it('accepts CMS layout', () => {
      expect(layoutSchema.safeParse({ type: 'cms', collection_id: 'col-1' }).success).toBe(true);
    });
    it('accepts outline layout with typed sections', () => {
      expect(layoutSchema.safeParse({
        type: 'outline',
        structure: {
          sections: [
            { heading: { level: 1, text: 'H1' } },
            { heading: { level: 2, text: 'H2' }, bullets: ['a', 'b'], media: { type: 'image', placeholder: 'hero' } },
          ],
        },
      }).success).toBe(true);
    });
    it('rejects freeform string structure', () => {
      expect(layoutSchema.safeParse({ type: 'outline', structure: 'H1, H2, H3' }).success).toBe(false);
    });
  });

  describe('startSeoAuditInputSchema', () => {
    it('requires site_id', () => {
      expect(startSeoAuditInputSchema.safeParse({ workspace_id: 'ws-1' }).success).toBe(false);
      expect(startSeoAuditInputSchema.safeParse({ workspace_id: 'ws-1', site_id: 'site-1' }).success).toBe(true);
    });
    it('accepts optional skip_link_check', () => {
      expect(startSeoAuditInputSchema.safeParse({
        workspace_id: 'ws-1',
        site_id: 'site-1',
        options: { skip_link_check: true },
      }).success).toBe(true);
    });
  });

  describe('sendToClientInputSchema', () => {
    const validBriefHandle = `brief_${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`;
    const validPostHandle = `post_${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`;

    it('accepts brief_handle', () => {
      expect(sendToClientInputSchema.safeParse({ workspace_id: 'ws-1', brief_handle: validBriefHandle }).success).toBe(true);
    });
    it('accepts post_handle with note', () => {
      expect(sendToClientInputSchema.safeParse({ workspace_id: 'ws-1', post_handle: validPostHandle, note: 'ready' }).success).toBe(true);
    });
    it('rejects providing both brief_handle and post_handle', () => {
      expect(sendToClientInputSchema.safeParse({
        workspace_id: 'ws-1',
        brief_handle: validBriefHandle,
        post_handle: validPostHandle,
      }).success).toBe(false);
    });
  });

  describe('all schemas export', () => {
    it('every Phase 2 tool has an input schema exported', () => {
      const schemas = [
        researchKeywordsInputSchema,
        addKeywordToStrategyInputSchema,
        prepareBriefContextInputSchema,
        saveBriefInputSchema,
        preparePostContextInputSchema,
        savePostInputSchema,
        sendToClientInputSchema,
        startKeywordStrategyGenerationInputSchema,
        startSeoAuditInputSchema,
        startLocalSeoRefreshInputSchema,
      ];
      expect(schemas).toHaveLength(10);
      for (const schema of schemas) {
        expect(schema).toBeDefined();
        expect(typeof schema.safeParse).toBe('function');
      }
    });
  });

  it('typedOutlineSchema exports and accepts a minimal section', () => {
    expect(typedOutlineSchema.safeParse({ sections: [{ heading: { level: 1, text: 'x' } }] }).success).toBe(true);
  });
});
