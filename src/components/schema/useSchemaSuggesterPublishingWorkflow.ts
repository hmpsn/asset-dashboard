import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { post, put } from '../../api/client';
import { schema as schemaApi } from '../../api/seo';
import { usePageEditStates } from '../../hooks/usePageEditStates';
import type { SchemaDeliveryDecision, SchemaPublishResponse } from '../../../shared/types/schema-generation';
import type { SchemaPageSuggestion, SchemaSuggestion } from './schemaSuggesterTypes';

interface UseSchemaSuggesterPublishingWorkflowOptions {
  siteId: string;
  workspaceId?: string;
  data: SchemaPageSuggestion[] | null;
  setData: Dispatch<SetStateAction<SchemaPageSuggestion[] | null>>;
  bulkPublishBlocked?: boolean;
}

export function useSchemaSuggesterPublishingWorkflow({
  siteId,
  workspaceId,
  data,
  setData,
  bulkPublishBlocked = false,
}: UseSchemaSuggesterPublishingWorkflowOptions) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const [published, setPublished] = useState<Set<string>>(new Set());
  const [publishError, setPublishError] = useState<Record<string, string>>({});
  const [manualDelivery, setManualDelivery] = useState<Record<string, SchemaDeliveryDecision>>({});
  const [confirmPublish, setConfirmPublish] = useState<string | null>(null);
  const [sendingToClient, setSendingToClient] = useState(false);
  const [sentToClient, setSentToClient] = useState(false);
  const [approvalRefreshKey, setApprovalRefreshKey] = useState(0);
  const [sendingPage, setSendingPage] = useState<Set<string>>(new Set());
  const [sentPages, setSentPages] = useState<Set<string>>(new Set());
  const [retractingPages, setRetractingPages] = useState<Set<string>>(new Set());
  const [retractedPages, setRetractedPages] = useState<Set<string>>(new Set());
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [showDiff, setShowDiff] = useState<Set<string>>(new Set());
  const [editingSchema, setEditingSchema] = useState<Set<string>>(new Set());
  const [editedSchemaJson, setEditedSchemaJson] = useState<Record<string, string>>({});
  const [schemaParseError, setSchemaParseError] = useState<Record<string, string>>({});
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  const { getState, refresh: refreshStates, summary } = usePageEditStates(workspaceId);

  const getEffectiveSchema = useCallback((pageId: string, original: Record<string, unknown>): Record<string, unknown> => {
    if (editedSchemaJson[pageId]) {
      try { return JSON.parse(editedSchemaJson[pageId]); } catch { /* fall through to original */ }
    }
    return original;
  }, [editedSchemaJson]);

  const sendSchemasToClient = useCallback(async (note?: string) => {
    if (!data || !workspaceId) return;
    setSendingToClient(true);
    try {
      const items = data.map(page => ({
        pageId: page.pageId,
        pageTitle: page.pageTitle,
        pageSlug: page.slug,
        publishedPath: page.publishedPath,
        field: 'schema',
        currentValue: page.existingSchemas.length > 0 ? page.existingSchemas.join(', ') : '',
        proposedValue: JSON.stringify(getEffectiveSchema(page.pageId, page.suggestedSchemas[0]?.template || {}), null, 2),
      }));
      await post(`/api/approvals/${workspaceId}`, { siteId, name: 'Schema Review', items, ...(note ? { note } : {}) });
      setSentToClient(true);
      refreshStates();
      setApprovalRefreshKey(k => k + 1);
    } catch (err) {
      console.error('SchemaSuggester operation failed:', err);
    } finally {
      setSendingToClient(false);
    }
  }, [data, getEffectiveSchema, refreshStates, siteId, workspaceId]);

  const publishToWebflow = useCallback(async (pageId: string, schema: Record<string, unknown>) => {
    setPublishing(prev => new Set(prev).add(pageId));
    setPublishError(prev => { const n = { ...prev }; delete n[pageId]; return n; });
    setManualDelivery(prev => { const n = { ...prev }; delete n[pageId]; return n; });
    setConfirmPublish(null);
    try {
      const pageData = data?.find(p => p.pageId === pageId);
      const isHomepage = !pageData?.slug || pageData.slug === '/' || pageData.slug === 'index' || pageData.slug === 'home';
      const result = await post<SchemaPublishResponse>(`/api/webflow/schema-publish/${siteId}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, {
        pageId,
        schema,
        publishAfter: true,
        isHomepage,
        pageSlug: pageData?.slug,
        publishedPath: pageData?.publishedPath,
        pageTitle: pageData?.pageTitle,
      });
      if (result.delivery?.status === 'manual-required') {
        setManualDelivery(prev => ({ ...prev, [pageId]: result.delivery }));
        return;
      }
      setPublished(prev => new Set(prev).add(pageId));
      refreshStates();
    } catch (err) {
      setPublishError(prev => ({ ...prev, [pageId]: err instanceof Error ? err.message : 'Publish failed' }));
    } finally {
      setPublishing(prev => {
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
    }
  }, [data, refreshStates, siteId, workspaceId]);

  const toggleSchemaEdit = useCallback((pageId: string, template: Record<string, unknown>) => {
    setEditingSchema(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
        if (editedSchemaJson[pageId]) {
          try {
            JSON.parse(editedSchemaJson[pageId]);
            setSchemaParseError(prevErrors => { const n = { ...prevErrors }; delete n[pageId]; return n; });
          } catch (e) {
            setSchemaParseError(prevErrors => ({ ...prevErrors, [pageId]: e instanceof Error ? e.message : 'Invalid JSON' }));
          }
        }
      } else {
        next.add(pageId);
        if (!editedSchemaJson[pageId]) {
          setEditedSchemaJson(prevJson => ({ ...prevJson, [pageId]: JSON.stringify(template, null, 2) }));
        }
      }
      return next;
    });
  }, [editedSchemaJson]);

  const handleSchemaJsonChange = useCallback((pageId: string, value: string) => {
    setEditedSchemaJson(prev => ({ ...prev, [pageId]: value }));
    try {
      JSON.parse(value);
      setSchemaParseError(prev => { const n = { ...prev }; delete n[pageId]; return n; });
    } catch (e) {
      setSchemaParseError(prev => ({ ...prev, [pageId]: e instanceof Error ? e.message : 'Invalid JSON' }));
    }
  }, []);

  const copyTemplate = useCallback((suggestion: SchemaSuggestion, pageId: string) => {
    const effective = getEffectiveSchema(pageId, suggestion.template);
    const json = JSON.stringify(effective, null, 2);
    const script = `<script type="application/ld+json">\n${json}\n</script>`;
    navigator.clipboard.writeText(script);
    setCopiedId(`${pageId}-${suggestion.type}`);
    setTimeout(() => setCopiedId(null), 2000);
  }, [getEffectiveSchema]);

  const copyJsonLd = useCallback((suggestion: SchemaSuggestion, pageId: string) => {
    const json = manualDelivery[pageId]?.jsonLd || JSON.stringify(getEffectiveSchema(pageId, suggestion.template), null, 2);
    navigator.clipboard.writeText(json);
    setCopiedId(`${pageId}-${suggestion.type}-json`);
    setTimeout(() => setCopiedId(null), 2000);
  }, [getEffectiveSchema, manualDelivery]);

  const sendSingleSchemaToClient = useCallback(async (page: SchemaPageSuggestion, note?: string) => {
    if (!workspaceId) return;
    setSendingPage(prev => new Set(prev).add(page.pageId));
    try {
      const items = [{
        pageId: page.pageId,
        pageTitle: page.pageTitle,
        pageSlug: page.slug,
        publishedPath: page.publishedPath,
        field: 'schema',
        currentValue: page.existingSchemas.length > 0 ? page.existingSchemas.join(', ') : '',
        proposedValue: JSON.stringify(getEffectiveSchema(page.pageId, page.suggestedSchemas[0]?.template || {}), null, 2),
      }];
      await post(`/api/approvals/${workspaceId}`, { siteId, name: `Schema: ${page.pageTitle}`, items, ...(note ? { note } : {}) });
      setSentPages(prev => new Set(prev).add(page.pageId));
      setApprovalRefreshKey(k => k + 1);
    } catch (err) {
      console.error('SchemaSuggester operation failed:', err);
    } finally {
      setSendingPage(prev => {
        const next = new Set(prev);
        next.delete(page.pageId);
        return next;
      });
    }
  }, [getEffectiveSchema, siteId, workspaceId]);

  const saveAsTemplate = useCallback(async (pageId: string) => {
    const page = data?.find(p => p.pageId === pageId);
    if (!page?.suggestedSchemas[0]) return;
    const schema = getEffectiveSchema(pageId, page.suggestedSchemas[0].template);
    const graph = schema?.['@graph'] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(graph)) return;
    const orgNode = graph.find(n => n['@type'] === 'Organization');
    const wsNode = graph.find(n => n['@type'] === 'WebSite');
    if (!orgNode) return;
    const websiteNode = wsNode || { '@type': 'WebSite', '@id': `${orgNode['url']}/#website`, 'url': orgNode['url'], 'name': orgNode['name'], 'publisher': { '@id': `${orgNode['url']}/#organization` } };
    setSavingTemplate(true);
    try {
      await put(`/api/webflow/schema-template/${siteId}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, { organizationNode: orgNode, websiteNode });
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 3000);
    } catch (err) {
      console.error('SchemaSuggester operation failed:', err);
    } finally {
      setSavingTemplate(false);
    }
  }, [data, getEffectiveSchema, siteId, workspaceId]);

  const publishAllToWebflow = useCallback(async () => {
    if (bulkPublishBlocked) return;
    if (!data) return;
    const publishable = data.filter(p => !p.pageId.startsWith('cms-') && !published.has(p.pageId) && p.suggestedSchemas[0]?.template);
    if (publishable.length === 0) return;
    setBulkPublishing(true);
    setBulkProgress({ done: 0, total: publishable.length });
    for (let i = 0; i < publishable.length; i++) {
      const page = publishable[i];
      await publishToWebflow(page.pageId, getEffectiveSchema(page.pageId, page.suggestedSchemas[0].template));
      setBulkProgress({ done: i + 1, total: publishable.length });
    }
    setBulkPublishing(false);
    setBulkProgress(null);
  }, [bulkPublishBlocked, data, getEffectiveSchema, publishToWebflow, published]);

  const toggleDiff = useCallback((pageId: string) => {
    setShowDiff(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
      return next;
    });
  }, []);

  const retractSchema = useCallback(async (pageId: string) => {
    setRetractingPages(prev => new Set(prev).add(pageId));
    try {
      await schemaApi.retract(siteId, pageId, workspaceId);
      setRetractedPages(prev => new Set(prev).add(pageId));
      setPublished(prev => { const n = new Set(prev); n.delete(pageId); return n; });
      setManualDelivery(prev => { const n = { ...prev }; delete n[pageId]; return n; });
    } catch (err) {
      setPublishError(prev => ({ ...prev, [pageId]: err instanceof Error ? err.message : 'Retract failed' }));
    } finally {
      setRetractingPages(prev => { const n = new Set(prev); n.delete(pageId); return n; });
    }
  }, [siteId, workspaceId]);

  const restoreSchema = useCallback((pageId: string, restoredSchema: Record<string, unknown>) => {
    setData(prev => {
      if (!prev) return prev;
      return prev.map(p => {
        if (p.pageId !== pageId) return p;
        return {
          ...p,
          suggestedSchemas: [{
            ...(p.suggestedSchemas[0] || { type: 'restored', priority: 'high' as const }),
            template: restoredSchema,
            reason: `Restored from version history (${new Date().toLocaleDateString()})`,
          }],
          lastPublishedAt: new Date().toISOString(),
        };
      });
    });
    setPublished(prev => new Set(prev).add(pageId));
    setManualDelivery(prev => { const n = { ...prev }; delete n[pageId]; return n; });
  }, [setData]);

  const clearManualDeliveryForPage = useCallback((pageId: string) => {
    setManualDelivery(prev => {
      const next = { ...prev };
      delete next[pageId];
      return next;
    });
  }, []);

  const unpublishedCount = data?.filter(p => !p.pageId.startsWith('cms-') && !published.has(p.pageId) && p.suggestedSchemas[0]?.template).length ?? 0;

  return {
    copiedId,
    publishing,
    published,
    publishError,
    manualDelivery,
    confirmPublish,
    setConfirmPublish,
    sendingToClient,
    sentToClient,
    approvalRefreshKey,
    setApprovalRefreshKey,
    sendingPage,
    sentPages,
    retractingPages,
    retractedPages,
    bulkPublishing,
    bulkProgress,
    showDiff,
    editingSchema,
    editedSchemaJson,
    schemaParseError,
    savingTemplate,
    templateSaved,
    getState,
    summary,
    unpublishedCount,
    getEffectiveSchema,
    sendSchemasToClient,
    publishToWebflow,
    toggleSchemaEdit,
    handleSchemaJsonChange,
    copyTemplate,
    copyJsonLd,
    sendSingleSchemaToClient,
    saveAsTemplate,
    publishAllToWebflow,
    toggleDiff,
    retractSchema,
    restoreSchema,
    clearManualDeliveryForPage,
  };
}
