import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { post, put } from '../../api/client';
import { schema as schemaApi } from '../../api/schema';
import { usePageEditStates } from '../../hooks/usePageEditStates';
import type { SchemaDeliveryDecision, SchemaPublishResponse } from '../../../shared/types/schema-generation';
import type { SchemaPageSuggestion, SchemaSuggestion } from './schemaSuggesterTypes';
import { formatDate } from '../../utils/formatDates';

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
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  const [sendToClientError, setSendToClientError] = useState<string | null>(null);
  const [sendPageErrors, setSendPageErrors] = useState<Record<string, string>>({});

  const { getState, refresh: refreshStates, summary } = usePageEditStates(workspaceId);

  // Seed the published Set from each page's lastPublishedAt so the Published badge,
  // Retract CTA, and Publish All count survive reload. Without this the Set starts
  // empty on every mount: previously-published pages would show the Publish CTA again
  // and Publish All would over-count + re-publish already-live pages.
  //
  // Merge semantics: we ADD pages that the server reports as published, but never
  // REMOVE in-session state. Pages the user retracted this session (retractedPages)
  // are excluded so a stale lastPublishedAt cannot resurrect a just-retracted page.
  useEffect(() => { // effect-layout-ok: snapshot data (with lastPublishedAt) arrives asynchronously from React Query.
    if (!data) return;
    const serverPublished = data
      .filter(page => !!page.lastPublishedAt && !retractedPages.has(page.pageId))
      .map(page => page.pageId);
    if (serverPublished.length === 0) return;
    setPublished(prev => {
      const missing = serverPublished.filter(id => !prev.has(id));
      if (missing.length === 0) return prev; // no change — avoid re-render churn
      const next = new Set(prev);
      for (const id of missing) next.add(id);
      return next;
    });
  }, [data, retractedPages]);

  const getEffectiveSchema = useCallback((pageId: string, original: Record<string, unknown>): Record<string, unknown> => {
    if (editedSchemaJson[pageId]) {
      try { return JSON.parse(editedSchemaJson[pageId]); } catch { /* fall through to original */ }
    }
    return original;
  }, [editedSchemaJson]);

  const sendSchemasToClient = useCallback(async (note?: string) => {
    if (!data || !workspaceId) return;
    setSendingToClient(true);
    setSendToClientError(null);
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
      setSendToClientError(err instanceof Error ? err.message : 'Failed to send schemas to client. Please try again.');
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
    setSendPageErrors(prev => { const n = { ...prev }; delete n[page.pageId]; return n; });
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
      setSendPageErrors(prev => ({ ...prev, [page.pageId]: err instanceof Error ? err.message : 'Failed to send to client. Please try again.' }));
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
    setTemplateSaveError(null);
    try {
      await put(`/api/webflow/schema-template/${siteId}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, { organizationNode: orgNode, websiteNode });
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 3000);
    } catch (err) {
      setTemplateSaveError(err instanceof Error ? err.message : 'Failed to save template. Please try again.');
    } finally {
      setSavingTemplate(false);
    }
  }, [data, getEffectiveSchema, siteId, workspaceId]);

  const publishAllToWebflow = useCallback(async () => {
    if (bulkPublishBlocked) return;
    if (!data) return;
    // Include static pages unconditionally; include CMS pages only when cmsDeliveryStatus === 'ready'.
    const publishable = data.filter(p => {
      if (published.has(p.pageId) || !p.suggestedSchemas[0]?.template) return false;
      if (p.pageId.startsWith('cms-')) return p.cmsDeliveryStatus?.status === 'ready';
      return true;
    });
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
            reason: `Restored from version history (${formatDate(new Date())})`,
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

  // Clear a single page's stale manual JSON edit (+ parse error + open editor) when its
  // schema is regenerated. getEffectiveSchema prefers editedSchemaJson[pageId], so an
  // un-cleared edit silently overrides the freshly-regenerated schema in preview, Publish,
  // Copy, and send-to-client — stale schema could ship to a client. Clearing makes the
  // regenerated schema authoritative.
  const clearManualEditForPage = useCallback((pageId: string) => {
    setEditedSchemaJson(prev => {
      if (!(pageId in prev)) return prev;
      const next = { ...prev };
      delete next[pageId];
      return next;
    });
    setSchemaParseError(prev => {
      if (!(pageId in prev)) return prev;
      const next = { ...prev };
      delete next[pageId];
      return next;
    });
    setEditingSchema(prev => {
      if (!prev.has(pageId)) return prev;
      const next = new Set(prev);
      next.delete(pageId);
      return next;
    });
  }, []);

  // Clear ALL manual JSON edits — used on full re-scan (every page is regenerated).
  const clearAllManualEdits = useCallback(() => {
    setEditedSchemaJson(prev => (Object.keys(prev).length === 0 ? prev : {}));
    setSchemaParseError(prev => (Object.keys(prev).length === 0 ? prev : {}));
    setEditingSchema(prev => (prev.size === 0 ? prev : new Set()));
  }, []);

  // Mirrors the publishAllToWebflow filter: static pages count always; CMS pages count only when ready.
  const unpublishedCount = data?.filter(p => {
    if (published.has(p.pageId) || !p.suggestedSchemas[0]?.template) return false;
    if (p.pageId.startsWith('cms-')) return p.cmsDeliveryStatus?.status === 'ready';
    return true;
  }).length ?? 0;

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
    sendToClientError,
    setSendToClientError,
    approvalRefreshKey,
    setApprovalRefreshKey,
    sendingPage,
    sentPages,
    sendPageErrors,
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
    templateSaveError,
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
    clearManualEditForPage,
    clearAllManualEdits,
  };
}
