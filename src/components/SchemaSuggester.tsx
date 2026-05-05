import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { post, put, get, getSafe } from '../api/client';
import { schema as schemaApi, schemaImpact as schemaImpactApi, type SchemaImpactData, type SchemaDeploymentImpact } from '../api/seo';
import type { FixContext } from '../App';
import { useSchemaSnapshot, useWebflowPages } from '../hooks/admin';
import {
  Loader2, CheckCircle,
  Info, Sparkles, RefreshCw, Plus, Database, HelpCircle,
  Clock, BarChart3, BookOpen, AlertTriangle, X,
} from 'lucide-react';
import type { BusinessProfileContact } from '../../shared/types/workspace.js';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { useRecommendations } from '../hooks/useRecommendations';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { StatusBadge, Icon, cn } from './ui';
import { WorkflowStepper, ErrorState, ProgressIndicator, NextStepsCard, TrendBadge } from './ui';
import { CmsTemplatePanel } from './schema/CmsTemplatePanel';
import { SchemaPageCard } from './schema/SchemaPageCard';
import { BulkPublishPanel } from './schema/BulkPublishPanel';
import { PagePicker } from './schema/PagePicker';
import { SchemaPlanPanel } from './schema/SchemaPlanPanel';
import { SchemaCompletenessWidget } from './schema/SchemaCompletenessWidget';
import { KNOWN_TARGET_FIELDS } from './schema/fieldTargets';
import { PendingApprovals } from './PendingApprovals';
import { SchemaWorkflowGuide } from './schema/SchemaWorkflowGuide';
import { SCHEMA_ROLE_INDEX, SCHEMA_ROLE_LABELS } from '../../shared/types/schema-plan';
import type { ValidationFinding } from '../../shared/types/schema-validation';
import type { SchemaDeliveryDecision, SchemaGenerationDiagnostics, SchemaPublishResponse } from '../../shared/types/schema-generation';
import type { CmsSchemaFieldMapping, SchemaFieldTarget } from '../../shared/types/site-inventory';
import { adminPath } from '../routes.js';
import { queryKeys } from '../lib/queryKeys';

type SchemaSubTab = 'generator' | 'guide';

interface SchemaSuggestion {
  type: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  template: Record<string, unknown>;
}

interface RichResultEligibility {
  type: string;
  eligible: boolean;
  feature: string;
  missingFields?: string[];
}

interface SchemaPageSuggestion {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  existingSchemaJson?: Record<string, unknown>[];
  suggestedSchemas: SchemaSuggestion[];
  validationErrors?: string[];
  validationFindings?: ValidationFinding[];
  richResultsEligibility?: RichResultEligibility[];
  generationDiagnostics?: SchemaGenerationDiagnostics;
  lastPublishedAt?: string | null;
}

interface CmsTemplatePage {
  pageId: string;
  pageTitle: string;
  slug: string;
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
}

interface CmsTemplateResult {
  templateString: string;
  schemaTypes: string[];
  fieldsUsed: string[];
  collectionName: string;
  collectionSlug: string;
}

interface CmsMappingField {
  slug: string;
  displayName: string;
  type: string;
  target?: SchemaFieldTarget;
}

interface CmsMappingCollection {
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
  fields: CmsMappingField[];
  recommendedFieldSlug?: string;
  mapping: CmsSchemaFieldMapping | null;
}

interface CmsMappingsResponse {
  collections: CmsMappingCollection[];
}

interface Props {
  siteId: string;
  workspaceId?: string;
  fixContext?: FixContext | null;
  businessProfile?: BusinessProfileContact | null;
}

const MAX_SCHEMA_MAPPING_COLLECTIONS = 4;

export function SchemaSuggester({ siteId, workspaceId, fixContext, businessProfile }: Props) {
  const [schemaSubTab, setSchemaSubTab] = useState<SchemaSubTab>('generator');
  const { forPage: recsForPage, loaded: recsLoaded } = useRecommendations(workspaceId);
  const [data, setData] = useState<SchemaPageSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const [published, setPublished] = useState<Set<string>>(new Set());
  const [publishError, setPublishError] = useState<Record<string, string>>({});
  const [manualDelivery, setManualDelivery] = useState<Record<string, SchemaDeliveryDecision>>({});
  const [scanError, setScanError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<string | null>(null);
  const [sendingToClient, setSendingToClient] = useState(false);
  const [sentToClient, setSentToClient] = useState(false);
  const [approvalRefreshKey, setApprovalRefreshKey] = useState(0);
  const [sendingPage, setSendingPage] = useState<Set<string>>(new Set());
  const [sentPages, setSentPages] = useState<Set<string>>(new Set());
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [showNextSteps, setShowNextSteps] = useState(false);
  const [showPagePicker, setShowPagePicker] = useState(false);
  const [availablePages, setAvailablePages] = useState<Array<{ id: string; title: string; slug: string }>>([]);
  const [pageSearch, setPageSearch] = useState('');
  const [loadingPages, setLoadingPages] = useState(false);
  const [generatingSingle, setGeneratingSingle] = useState<string | null>(null);
  const [pageTypes, setPageTypes] = useState<Record<string, string>>({});
  const [retractingPages, setRetractingPages] = useState<Set<string>>(new Set());
  const [retractedPages, setRetractedPages] = useState<Set<string>>(new Set());
  const { jobs, startJob, cancelJob } = useBackgroundTasks();
  const jobIdRef = useRef<string | null>(null);

  // Auto-generate for a specific page when arriving from audit Fix→
  // Guard on targetRoute so stale fixContext from other tabs doesn't trigger generation.
  const fixConsumed = useRef(false);
  useEffect(() => {
    if (fixContext?.pageId && fixContext.targetRoute === 'seo-schema' && !fixConsumed.current) {
      fixConsumed.current = true;
      // Small delay to let snapshot load finish first
      const timer = setTimeout(() => {
        generateSinglePage(fixContext.pageId!);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [fixContext]); // generateSinglePage intentionally excluded — ref guard prevents re-fire

  // CMS template schema state
  const dismissedKey = workspaceId ? `schema-bp-callout-dismissed-${workspaceId}` : null;
  const [calloutDismissed, setCalloutDismissed] = useState(() =>
    dismissedKey ? localStorage.getItem(dismissedKey) === '1' : true,
  );
  // Gate matches the template gate — LocalBusiness refs require street or city
  const showBpCallout = !calloutDismissed && !!workspaceId && !(businessProfile?.address?.street || businessProfile?.address?.city);
  const dismissBpCallout = () => {
    if (dismissedKey) localStorage.setItem(dismissedKey, '1');
    setCalloutDismissed(true);
  };

  const [showCmsPanel, setShowCmsPanel] = useState(false);
  const [showTypeGuide, setShowTypeGuide] = useState(false);
  const [cmsTemplatePages, setCmsTemplatePages] = useState<CmsTemplatePage[]>([]);
  const [loadingCmsPages, setLoadingCmsPages] = useState(false);
  const [generatingCmsTemplate, setGeneratingCmsTemplate] = useState<string | null>(null);
  const [cmsTemplateResult, setCmsTemplateResult] = useState<CmsTemplateResult | null>(null);
  const [cmsSelectedPage, setCmsSelectedPage] = useState<CmsTemplatePage | null>(null);
  const [publishingCmsTemplate, setPublishingCmsTemplate] = useState(false);
  const [cmsPublished, setCmsPublished] = useState(false);
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [showDiff, setShowDiff] = useState<Set<string>>(new Set());
  const [cmsCopied, setCmsCopied] = useState(false);
  const [cmsError, setCmsError] = useState<string | null>(null);
  const [cmsMappingError, setCmsMappingError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const cmsMappingsQuery = useQuery({
    queryKey: queryKeys.admin.schemaCmsFieldMappings(siteId, workspaceId),
    queryFn: () => get<CmsMappingsResponse>(
      `/api/webflow/schema-cms-field-mappings/${siteId}?workspaceId=${encodeURIComponent(workspaceId ?? '')}`,
    ),
    enabled: !!siteId && !!workspaceId,
    staleTime: 30_000,
  });
  const cmsMappings = cmsMappingsQuery.data?.collections ?? [];
  const saveCmsMappingMutation = useMutation({
    mutationFn: async ({ collection, target, slug }: { collection: CmsMappingCollection; target: SchemaFieldTarget; slug: string }) => {
      const fieldMappings = { ...(collection.mapping?.fieldMappings ?? {}) };
      const trimmed = slug.trim();
      if (trimmed) {
        fieldMappings[target] = trimmed;
      } else {
        delete fieldMappings[target];
      }
      const mapping = await put<CmsSchemaFieldMapping>(
        `/api/webflow/schema-cms-field-mappings/${siteId}?workspaceId=${encodeURIComponent(workspaceId ?? '')}`,
        {
          collectionId: collection.collectionId,
          collectionName: collection.collectionName,
          collectionSlug: collection.collectionSlug,
          schemaFieldSlug: collection.mapping?.schemaFieldSlug || collection.recommendedFieldSlug,
          collectionRole: collection.mapping?.collectionRole,
          fieldMappings,
        },
      );
      return { collectionId: collection.collectionId, mapping };
    },
    onMutate: () => setCmsMappingError(null),
    onSuccess: ({ collectionId, mapping }) => {
      queryClient.setQueryData<CmsMappingsResponse>(
        queryKeys.admin.schemaCmsFieldMappings(siteId, workspaceId),
        old => ({
          collections: (old?.collections ?? []).map(collection => (
            collection.collectionId === collectionId ? { ...collection, mapping } : collection
          )),
        }),
      );
    },
    onError: err => {
      setCmsMappingError(err instanceof Error ? err.message : 'Failed to save CMS field mapping');
    },
  });
  const savingCmsMapping = saveCmsMappingMutation.isPending && saveCmsMappingMutation.variables
    ? `${saveCmsMappingMutation.variables.collection.collectionId}:${saveCmsMappingMutation.variables.target}`
    : null;

  const saveCmsFieldMapping = (collection: CmsMappingCollection, target: SchemaFieldTarget, slug: string) => {
    if (!workspaceId) return;
    saveCmsMappingMutation.mutate({ collection, target, slug });
  };

  // Schema editing state — stores edited JSON string per pageId
  const [editingSchema, setEditingSchema] = useState<Set<string>>(new Set());
  const [editedSchemaJson, setEditedSchemaJson] = useState<Record<string, string>>({});
  const [schemaParseError, setSchemaParseError] = useState<Record<string, string>>({});

  // Unified page edit states
  const { getState, refresh: refreshStates, summary } = usePageEditStates(workspaceId);

  // Load saved schema snapshot — React Query
  const { data: snapshotData } = useSchemaSnapshot(siteId, workspaceId);
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  // Hydrate local state from snapshot query when it arrives
  useEffect(() => { // effect-layout-ok: saved snapshot arrives asynchronously from React Query.
    if (!snapshotData) {
      setSnapshotDate(null);
      setData(null);
      return;
    }
    setSnapshotDate(prev => prev === snapshotData.createdAt ? prev : snapshotData.createdAt);
    if (snapshotData.results.length > 0) {
      setData(snapshotData.results as SchemaPageSuggestion[]);
      setStarted(true);
    }
    // Hydrate page types from savedPageType on each result (don't overwrite locally-set types)
    const typesFromSnapshot: Record<string, string> = {};
    for (const r of snapshotData.results as SchemaPageSuggestion[]) {
      if ((r as unknown as { savedPageType?: string }).savedPageType) {
        typesFromSnapshot[r.pageId] = (r as unknown as { savedPageType?: string }).savedPageType!;
      }
    }
    if (Object.keys(typesFromSnapshot).length > 0) {
      setPageTypes(prev => ({ ...typesFromSnapshot, ...prev }));
    }
  }, [snapshotData]);

  // Load persisted page types from server on mount
  useEffect(() => { // effect-layout-ok: persisted page types arrive asynchronously from the server.
    if (!siteId) return;
    getSafe<{ pageTypes: Record<string, string> }>(`/api/webflow/schema-page-types/${siteId}?workspaceId=${workspaceId || ''}`, { pageTypes: {} })
      .then(({ pageTypes: saved }) => {
        if (saved && Object.keys(saved).length > 0) {
          setPageTypes(prev => ({ ...saved, ...prev }));
        }
      })
      .catch(() => { /* ignore — page types are non-critical */ });
  }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load all pages — React Query
  const { data: fetchedPages = [] } = useWebflowPages(siteId, workspaceId);
  useEffect(() => {
    if (fetchedPages.length > 0 && availablePages.length === 0) {
      setAvailablePages(fetchedPages);
    }
  }, [fetchedPages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stream partial results from background job via WebSocket
  useEffect(() => { // effect-layout-ok: background job results arrive asynchronously via WebSocket.
    if (!jobIdRef.current) return;
    const job = jobs.find(j => j.id === jobIdRef.current);
    if (!job) return;
    if (job.result && Array.isArray(job.result) && job.result.length > 0) {
      setData(job.result as SchemaPageSuggestion[]);
    }
    if (job.message) setProgressMsg(job.message);
    if (job.status === 'done') {
      setLoading(false);
      if (job.result && Array.isArray(job.result)) {
        setData(job.result as SchemaPageSuggestion[]);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.schemaSnapshot(siteId, workspaceId) });
      setShowNextSteps(true);
      setProgressMsg(null);
      jobIdRef.current = null;
    } else if (job.status === 'error') {
      setLoading(false);
      setScanError(job.error || 'Schema generation failed');
      setProgressMsg(null);
      jobIdRef.current = null;
    } else if (job.status === 'cancelled') {
      setLoading(false);
      setProgressMsg(null);
      jobIdRef.current = null;
    }
  }, [jobs]);

  const stopScan = () => {
    if (jobIdRef.current) cancelJob(jobIdRef.current);
  };

  const sendSchemasToClient = async () => {
    if (!data || !workspaceId) return;
    setSendingToClient(true);
    try {
      const items = data.map(page => ({
        pageId: page.pageId,
        pageTitle: page.pageTitle,
        pageSlug: page.slug,
        field: 'schema',
        currentValue: page.existingSchemas.length > 0 ? page.existingSchemas.join(', ') : '',
        proposedValue: JSON.stringify(getEffectiveSchema(page.pageId, page.suggestedSchemas[0]?.template || {}), null, 2),
      }));
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['x-auth-token'] = token;
      await post(`/api/approvals/${workspaceId}`, { siteId, name: 'Schema Review', items });
      setSentToClient(true);
      refreshStates();
      setApprovalRefreshKey(k => k + 1);
    } catch (err) { console.error('SchemaSuggester operation failed:', err); }
    setSendingToClient(false);
  };

  const runScan = async () => {
    setStarted(true);
    setLoading(true);
    setShowNextSteps(false);
    setData(null);
    setScanError(null);
    setProgressMsg('Starting schema generation...');
    const jobId = await startJob('schema-generator', { siteId, workspaceId: workspaceId || '' });
    if (jobId) {
      jobIdRef.current = jobId;
    } else {
      setScanError('Failed to start schema generation job');
      setLoading(false);
    }
  };

  const fetchPages = async () => {
    if (availablePages.length > 0) { setShowPagePicker(true); return; }
    setLoadingPages(true);
    try {
      const pages = await getSafe<Array<{ _id?: string; id?: string; title?: string; slug?: string }>>(`/api/webflow/pages/${siteId}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, []);
      if (Array.isArray(pages)) {
        setAvailablePages(pages.map((p: { _id?: string; id?: string; title?: string; slug?: string }) => ({
          id: p._id || p.id || '',
          title: p.title || p.slug || 'Untitled',
          slug: p.slug || '',
        })));
      }
      setShowPagePicker(true);
    } catch (err) { console.error('SchemaSuggester operation failed:', err); }
    setLoadingPages(false);
  };

  const generateSinglePage = async (pageId: string) => {
    setGeneratingSingle(pageId);
    setShowPagePicker(false);
    setStarted(true);
    try {
      const pt = pageTypes[pageId];
      const result = await post<SchemaPageSuggestion>(`/api/webflow/schema-suggestions/${siteId}/page${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, { pageId, pageType: pt && pt !== 'auto' ? pt : undefined });
      setData(prev => {
        if (!prev) return [result];
        const exists = prev.findIndex(p => p.pageId === pageId);
        if (exists >= 0) return prev.map(p => p.pageId === pageId ? result : p);
        return [...prev, result];
      });
      setExpanded(prev => new Set(prev).add(pageId));
      setManualDelivery(prev => { const n = { ...prev }; delete n[pageId]; return n; });
    } catch (err) {
      console.error('SchemaSuggester operation failed:', err);
      setScanError('Single page generation failed');
    } finally {
      setGeneratingSingle(null);
    }
  };

  const regeneratePage = async (pageId: string) => {
    setRegenerating(prev => new Set(prev).add(pageId));
    try {
      const result = await post<SchemaPageSuggestion>(`/api/webflow/schema-suggestions/${siteId}/page${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, { pageId });
      setData(prev => {
        if (!prev) return prev;
        // Full replacement — preserve lastPublishedAt which comes from the
        // snapshot endpoint annotation, not the generate response.
        return prev.map(p => p.pageId === pageId ? {
          ...result,
          lastPublishedAt: p.lastPublishedAt,
        } : p);
      });
      setExpanded(prev => new Set(prev).add(pageId));
      setManualDelivery(prev => { const n = { ...prev }; delete n[pageId]; return n; });
    } catch (err) {
      console.error('SchemaSuggester operation failed:', err);
      // keep existing data
    } finally {
      setRegenerating(prev => {
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
    }
  };

  const publishToWebflow = async (pageId: string, schema: Record<string, unknown>) => {
    setPublishing(prev => new Set(prev).add(pageId));
    setPublishError(prev => { const n = { ...prev }; delete n[pageId]; return n; });
    setManualDelivery(prev => { const n = { ...prev }; delete n[pageId]; return n; });
    setConfirmPublish(null);
    try {
      const pageData = data?.find(p => p.pageId === pageId);
      const isHomepage = !pageData?.slug || pageData.slug === '/' || pageData.slug === 'index' || pageData.slug === 'home';
      const result = await post<SchemaPublishResponse>(`/api/webflow/schema-publish/${siteId}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, { pageId, schema, publishAfter: true, isHomepage });
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
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Get effective schema for a page (edited version or original)
  const getEffectiveSchema = (pageId: string, original: Record<string, unknown>): Record<string, unknown> => {
    if (editedSchemaJson[pageId]) {
      try { return JSON.parse(editedSchemaJson[pageId]); } catch { /* fall through to original */ }
    }
    return original;
  };

  const toggleSchemaEdit = (pageId: string, template: Record<string, unknown>) => {
    setEditingSchema(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
        // Validate on close
        if (editedSchemaJson[pageId]) {
          try {
            JSON.parse(editedSchemaJson[pageId]);
            setSchemaParseError(prev => { const n = { ...prev }; delete n[pageId]; return n; });
          } catch (e) {
            setSchemaParseError(prev => ({ ...prev, [pageId]: e instanceof Error ? e.message : 'Invalid JSON' }));
          }
        }
      } else {
        next.add(pageId);
        // Initialize editor with current JSON if not already edited
        if (!editedSchemaJson[pageId]) {
          setEditedSchemaJson(prev => ({ ...prev, [pageId]: JSON.stringify(template, null, 2) }));
        }
      }
      return next;
    });
  };

  const handleSchemaJsonChange = (pageId: string, value: string) => {
    setEditedSchemaJson(prev => ({ ...prev, [pageId]: value }));
    try {
      JSON.parse(value);
      setSchemaParseError(prev => { const n = { ...prev }; delete n[pageId]; return n; });
    } catch (e) {
      setSchemaParseError(prev => ({ ...prev, [pageId]: e instanceof Error ? e.message : 'Invalid JSON' }));
    }
  };

  const copyTemplate = (suggestion: SchemaSuggestion, pageId: string) => {
    const effective = getEffectiveSchema(pageId, suggestion.template);
    const json = JSON.stringify(effective, null, 2);
    const script = `<script type="application/ld+json">\n${json}\n</script>`;
    navigator.clipboard.writeText(script);
    setCopiedId(`${pageId}-${suggestion.type}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copyJsonLd = (suggestion: SchemaSuggestion, pageId: string) => {
    const json = manualDelivery[pageId]?.jsonLd || JSON.stringify(getEffectiveSchema(pageId, suggestion.template), null, 2);
    navigator.clipboard.writeText(json);
    setCopiedId(`${pageId}-${suggestion.type}-json`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const sendSingleSchemaToClient = async (page: SchemaPageSuggestion) => {
    if (!workspaceId) return;
    setSendingPage(prev => new Set(prev).add(page.pageId));
    try {
      const items = [{
        pageId: page.pageId,
        pageTitle: page.pageTitle,
        pageSlug: page.slug,
        field: 'schema',
        currentValue: page.existingSchemas.length > 0 ? page.existingSchemas.join(', ') : '',
        proposedValue: JSON.stringify(getEffectiveSchema(page.pageId, page.suggestedSchemas[0]?.template || {}), null, 2),
      }];
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['x-auth-token'] = token;
      await post(`/api/approvals/${workspaceId}`, { siteId, name: `Schema: ${page.pageTitle}`, items });
      setSentPages(prev => new Set(prev).add(page.pageId));
      setApprovalRefreshKey(k => k + 1);
    } catch (err) { console.error('SchemaSuggester operation failed:', err); }
    setSendingPage(prev => {
      const next = new Set(prev);
      next.delete(page.pageId);
      return next;
    });
  };

  // Save schema as site template (extracts Org + WebSite from edited/original schema)
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const saveAsTemplate = async (pageId: string) => {
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
    } catch (err) { console.error('SchemaSuggester operation failed:', err); }
    setSavingTemplate(false);
  };

  // CMS template functions
  const fetchCmsTemplatePages = async () => {
    if (cmsTemplatePages.length > 0) { setShowCmsPanel(true); return; }
    setLoadingCmsPages(true);
    setCmsError(null);
    try {
      const pages = await getSafe<CmsTemplatePage[]>(`/api/webflow/cms-template-pages/${siteId}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, []);
      if (Array.isArray(pages)) setCmsTemplatePages(pages);
      setShowCmsPanel(true);
    } catch { setCmsError('Failed to load CMS collections'); }
    setLoadingCmsPages(false);
  };

  const generateCmsTemplate = async (page: CmsTemplatePage) => {
    setCmsSelectedPage(page);
    setGeneratingCmsTemplate(page.collectionId);
    setCmsTemplateResult(null);
    setCmsPublished(false);
    setCmsError(null);
    try {
      const result = await post<CmsTemplateResult>(`/api/webflow/schema-cms-template/${siteId}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, { collectionId: page.collectionId });
      setCmsTemplateResult(result);
    } catch (err) {
      setCmsError(err instanceof Error ? err.message : 'Failed to generate CMS template schema');
    }
    setGeneratingCmsTemplate(null);
  };

  const publishCmsTemplate = async () => {
    if (!cmsSelectedPage || !cmsTemplateResult) return;
    setPublishingCmsTemplate(true);
    setCmsError(null);
    try {
      await post(`/api/webflow/schema-cms-template/${siteId}/publish${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, {
        pageId: cmsSelectedPage.pageId,
        templateString: cmsTemplateResult.templateString,
        publishAfter: true,
      });
      setCmsPublished(true);
    } catch (err) {
      setCmsError(err instanceof Error ? err.message : 'Publish failed');
    }
    setPublishingCmsTemplate(false);
  };

  const copyCmsTemplate = () => {
    if (!cmsTemplateResult) return;
    const script = `<script type="application/ld+json">\n${cmsTemplateResult.templateString}\n</script>`;
    navigator.clipboard.writeText(script);
    setCmsCopied(true);
    setTimeout(() => setCmsCopied(false), 2000);
  };

  const publishAllToWebflow = async () => {
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
  };

  const toggleDiff = (pageId: string) => {
    setShowDiff(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
      return next;
    });
  };

  // ── Schema Impact Tracking (C6) ──
  const [impactData, setImpactData] = useState<SchemaImpactData | null>(null);
  const [showImpactDetail, setShowImpactDetail] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    schemaImpactApi.get(workspaceId)
      .then(d => { if (!cancelled) setImpactData(d); })
      .catch(() => { /* GSC not connected or no schema changes — silent */ });
    return () => { cancelled = true; };
  }, [workspaceId]);

  // Hooks must be called before ANY conditional early returns (Rules of Hooks).
  // `data` may be null while loading; guard inside the memo. (Devin Review BUG-0001 on PR #379.)
  const fixesAvailable = useMemo(() => {
    if (!data) return 0;
    const fields = new Set<string>();
    for (const p of data) {
      for (const f of p.validationFindings ?? []) {
        if (!f.field) continue;
        if (KNOWN_TARGET_FIELDS.has(f.field)) fields.add(f.field);
      }
    }
    return fields.size;
  }, [data]);

  const PAGE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'auto', label: 'Auto-detect' },
    ...Object.entries(SCHEMA_ROLE_LABELS).map(([value, label]) => ({ value, label })),
  ];

  const fieldMappingTargets: Array<{ target: SchemaFieldTarget; label: string; roles: Array<'location' | 'service'> }> = [
    { target: 'streetAddress', label: 'Street', roles: ['location'] },
    { target: 'addressLocality', label: 'City', roles: ['location'] },
    { target: 'addressRegion', label: 'State', roles: ['location'] },
    { target: 'postalCode', label: 'ZIP', roles: ['location'] },
    { target: 'phone', label: 'Phone', roles: ['location'] },
    { target: 'email', label: 'Email', roles: ['location'] },
    { target: 'openingHours', label: 'Hours', roles: ['location'] },
    { target: 'serviceName', label: 'Service name', roles: ['service'] },
    { target: 'serviceType', label: 'Service type', roles: ['service'] },
    { target: 'areaServed', label: 'Area served', roles: ['service'] },
    { target: 'price', label: 'Price', roles: ['service'] },
    { target: 'priceCurrency', label: 'Currency', roles: ['service'] },
  ];

  const schemaMappingCollections = cmsMappings
    .map(collection => {
      const role = collection.mapping?.collectionRole
        || (/(location|locations|clinic|clinics|store|stores|branch|branches)/i.test(`${collection.collectionName} ${collection.collectionSlug}`)
          ? 'location'
          : /(service|services|treatment|treatments|procedure|procedures)/i.test(`${collection.collectionName} ${collection.collectionSlug}`)
            ? 'service'
            : undefined);
      return role === 'location' || role === 'service' ? { ...collection, schemaRole: role } : null;
    })
    .filter((collection): collection is CmsMappingCollection & { schemaRole: 'location' | 'service' } => Boolean(collection));

  const filteredInitialPages = availablePages.filter(
    p => !pageSearch || p.title.toLowerCase().includes(pageSearch.toLowerCase()) || p.slug.toLowerCase().includes(pageSearch.toLowerCase())
  );

  const schemaTabBar = (
    <div className="flex items-center gap-1 border-b border-[var(--brand-border)] pb-0 mb-4">
      {([
        { id: 'generator' as SchemaSubTab, label: 'Generator', icon: Sparkles },
        { id: 'guide' as SchemaSubTab, label: 'Workflow Guide', icon: BookOpen },
      ]).map(t => (
        <button
          key={t.id}
          onClick={() => setSchemaSubTab(t.id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 t-caption font-medium border-b-2 transition-colors -mb-px',
            schemaSubTab === t.id
              ? 'border-teal-500 text-accent-brand'
              : 'border-transparent text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
          )}
        >
          <Icon as={t.icon} size="md" />
          {t.label}
        </button>
      ))}
    </div>
  );

  if (schemaSubTab === 'guide') {
    return <div>{schemaTabBar}<SchemaWorkflowGuide /></div>;
  }

  if (!started) {
    return (
      <div className="space-y-8">
        {schemaTabBar}
        {schemaSubTab === 'generator' && (
          <WorkflowStepper
            steps={[
              { number: 1, label: 'Scan', completed: false, current: true },
              { number: 2, label: 'Review', completed: false, current: false },
              { number: 3, label: 'Edit', completed: false, current: false },
              { number: 4, label: 'Publish', completed: false, current: false },
              { number: 5, label: 'Validate', completed: false, current: false },
            ]}
            compact
          />
        )}
        <div className="flex flex-col items-center justify-center py-8 gap-4">
          <div className="w-14 h-14 rounded-[var(--radius-xl)] bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
            <Icon as={Sparkles} size="2xl" className="text-accent-brand" />
          </div>
          <div className="text-center space-y-1.5">
            <p className="t-body font-medium text-[var(--brand-text-bright)]">Schema Generator</p>
            <p className="t-caption text-[var(--brand-text-muted)] max-w-sm">Generate optimized JSON-LD structured data. Optionally set page types below for more accurate schemas, then generate.</p>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={runScan}
              className="flex items-center gap-2 px-5 py-2.5 rounded-[var(--radius-md)] t-body font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors"
            >
              <Icon as={Sparkles} size="md" /> Generate All Pages
            </button>
            <button
              onClick={fetchCmsTemplatePages}
              disabled={loadingCmsPages}
              className="flex items-center gap-2 px-5 py-2.5 rounded-[var(--radius-md)] t-body font-medium bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-accent-warning border border-amber-500/30 transition-colors disabled:opacity-50"
            >
              {loadingCmsPages ? <Icon as={Loader2} size="md" className="animate-spin" /> : <Icon as={Database} size="md" />} CMS Templates
            </button>
          </div>
        </div>
        <SchemaPlanPanel siteId={siteId} workspaceId={workspaceId} />
        {showBpCallout && (
          <div role="alert" className="rounded-[var(--radius-lg)] border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-accent-warning flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="t-body text-accent-warning font-medium mb-1">Your business profile is incomplete</p>
              <p className="t-caption text-[var(--brand-text-muted)]">
                Add your address to unlock LocalBusiness schema on your homepage, /contact, and /about — the highest-value schema type for local businesses.
              </p>
              {workspaceId && (
                <Link
                  to={adminPath(workspaceId, 'workspace-settings') + '?tab=business-profile'}
                  className="t-caption text-accent-brand hover:text-accent-brand mt-2 inline-block"
                >
                  Complete business profile →
                </Link>
              )}
            </div>
            <button
              onClick={dismissBpCallout}
              className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <CmsTemplatePanel
          showCmsPanel={showCmsPanel}
          cmsTemplatePages={cmsTemplatePages}
          generatingCmsTemplate={generatingCmsTemplate}
          cmsTemplateResult={cmsTemplateResult}
          publishingCmsTemplate={publishingCmsTemplate}
          cmsPublished={cmsPublished}
          cmsCopied={cmsCopied}
          cmsError={cmsError}
          onClose={() => setShowCmsPanel(false)}
          onGenerateCmsTemplate={generateCmsTemplate}
          onCopyCmsTemplate={copyCmsTemplate}
          onPublishCmsTemplate={publishCmsTemplate}
        />
        {schemaMappingCollections.length > 0 && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4 space-y-3">
            <div>
              <p className="t-body text-[var(--brand-text)] font-medium">Collection field mapping</p>
              <p className="t-caption-sm text-[var(--brand-text-muted)]">
                Detected CMS fields can be corrected here so Locations and Services resolve human-readable schema data.
              </p>
              {cmsMappingError && (
                <p className="t-caption-sm text-amber-300 mt-1">{cmsMappingError}</p>
              )}
            </div>
            {schemaMappingCollections.slice(0, MAX_SCHEMA_MAPPING_COLLECTIONS).map(collection => (
              <div key={collection.collectionId} className="border-t border-[var(--brand-border)]/60 pt-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="t-caption text-[var(--brand-text)]">{collection.collectionName}</span>
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">{collection.schemaRole}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {fieldMappingTargets.filter(target => target.roles.includes(collection.schemaRole)).map(({ target, label }) => {
                    const selected = collection.mapping?.fieldMappings?.[target]
                      ?? collection.fields.find(field => field.target === target)?.slug
                      ?? '';
                    return (
                      <label key={target} className="block">
                        <span className="t-caption-sm text-[var(--brand-text-muted)]">{label}</span>
                        <select
                          value={selected}
                          disabled={savingCmsMapping === `${collection.collectionId}:${target}`}
                          onChange={event => saveCmsFieldMapping(collection, target, event.target.value)}
                          className="mt-1 w-full px-2 py-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption-sm text-[var(--brand-text)] focus:outline-none focus:border-teal-500 disabled:opacity-50"
                        >
                          <option value="">Not mapped</option>
                          {collection.fields.map(field => (
                            <option key={field.slug} value={field.slug}>
                              {field.displayName || field.slug} ({field.type})
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {generatingSingle && (
          <div className="flex items-center gap-2 px-4 py-2 bg-teal-500/10 border border-teal-500/20 rounded-[var(--radius-xl)]">
            <Icon as={Loader2} size="md" className="animate-spin text-accent-brand" />
            <span className="t-caption text-accent-brand">Generating schema for page...</span>
          </div>
        )}
        {/* Page list with type selectors */}
        {loadingPages ? (
          <div className="flex items-center justify-center py-6 gap-2 text-[var(--brand-text-muted)] t-caption">
            <Icon as={Loader2} size="md" className="animate-spin" /> Loading pages...
          </div>
        ) : availablePages.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
              <span className="t-caption text-[var(--brand-text-muted)]">{availablePages.length} pages — set page types for better AI prompts</span>
              <button
                onClick={() => setShowTypeGuide(v => !v)}
                className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                title="Page Type Guide"
              >
                <Icon as={HelpCircle} size="sm" />
                Guide
              </button>
            </div>
              <input
                type="text"
                value={pageSearch}
                onChange={e => setPageSearch(e.target.value)}
                placeholder="Filter pages..."
                className="px-3 py-1 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] t-caption text-[var(--brand-text)] w-48 focus:outline-none focus:border-[var(--brand-border-hover)]"
              />
            </div>
            {showTypeGuide && (
              <div className="bg-[var(--surface-1)]/50 rounded-[var(--radius-md)] border border-[var(--brand-border)] overflow-hidden max-h-[280px] overflow-y-auto">
                {PAGE_TYPE_OPTIONS.filter(o => o.value !== 'auto').map(opt => {
                  const info = SCHEMA_ROLE_INDEX[opt.value as keyof typeof SCHEMA_ROLE_INDEX];
                  if (!info) return null;
                  return (
                    <div key={opt.value} className="px-3 py-2 border-b border-[var(--brand-border)]/50 last:border-b-0">
                      <span className="t-caption-sm font-medium text-[var(--brand-text)]">{opt.label}</span>
                      <p className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed">{info.description}</p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {info.examples.map((ex: string) => (
                          <code key={ex} className="t-mono text-xs text-[var(--brand-text-muted)] bg-[var(--surface-3)]/60 px-1 py-0.5 rounded">{ex}</code>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden max-h-[400px] overflow-y-auto" style={{ borderRadius: 'var(--radius-signature)' }}>
              {filteredInitialPages.map(p => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--brand-border)]/50 last:border-b-0 hover:bg-[var(--surface-3)]/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="t-caption text-[var(--brand-text)] truncate">{p.title}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">/{p.slug}</div>
                  </div>
                  <select
                    value={pageTypes[p.id] || 'auto'}
                    onChange={e => setPageTypes(prev => ({ ...prev, [p.id]: e.target.value }))}
                    className="px-2 py-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption-sm text-[var(--brand-text)] focus:outline-none focus:border-teal-500 cursor-pointer"
                  >
                    {PAGE_TYPE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => generateSinglePage(p.id)}
                    disabled={generatingSingle === p.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-md)] t-caption-sm text-accent-brand bg-teal-600/10 border border-teal-500/20 hover:bg-teal-600/20 transition-colors disabled:opacity-50"
                  >
                    {generatingSingle === p.id ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={Sparkles} size="sm" />}
                    Generate
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (loading && (!data || data.length === 0)) {
    return (
      <div>
        {schemaTabBar}
        <ProgressIndicator
          status="running"
          step="Scanning schema opportunities..."
          detail={progressMsg || undefined}
          onCancel={stopScan}
        />
      </div>
    );
  }

  if (scanError) {
    return (
      <div>
        {schemaTabBar}
        <ErrorState
          type="general"
          title="Schema Scan Failed"
          message={scanError}
          action={{ label: 'Scan Again', onClick: runScan }}
        />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        {schemaTabBar}
        <Icon as={CheckCircle} size="2xl" className="text-accent-success" />
        <p className="text-[var(--brand-text-muted)] t-body">No schema suggestions needed</p>
        <button onClick={runScan} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] transition-colors mt-2">
          <Icon as={RefreshCw} size="sm" /> Re-scan
        </button>
      </div>
    );
  }

  const pagesWithExisting = data.filter(p => p.existingSchemas.length > 0).length;
  const pagesWithErrors = data.filter(p => (p.validationErrors?.length || 0) > 0).length;
  // Page count, not finding count — units must match `pagesWithErrors` since the display reads
  // "${N} with warnings" sister to "${N} with errors". A page with 3 warning findings counts once.
  // (Devin Review BUG-0001 on PR #376.)
  const pagesWithWarnings = data.filter(p =>
    (p.validationFindings?.some(f => f.severity === 'warning') ?? false),
  ).length;
  // fixesAvailable is hoisted above the early returns (Rules of Hooks); reuse here.
  const totalTypes = data.reduce((s, p) => {
    const schema = p.suggestedSchemas[0]?.template;
    const graph = schema?.['@graph'] as Record<string, unknown>[] | undefined;
    return s + (graph?.length || 0);
  }, 0);

  return (
    <div className="space-y-8">
      {schemaTabBar}
      {schemaSubTab === 'generator' && (
        <WorkflowStepper
          steps={[
            { number: 1, label: 'Scan', completed: !!data && data.length > 0, current: loading },
            { number: 2, label: 'Review', completed: false, current: !loading && !!data && data.length > 0 },
            { number: 3, label: 'Edit', completed: false, current: false },
            { number: 4, label: 'Publish', completed: false, current: false },
            { number: 5, label: 'Validate', completed: false, current: false },
          ]}
          compact
        />
      )}
      {/* Schema site plan */}
      <SchemaPlanPanel siteId={siteId} workspaceId={workspaceId} />

      {showBpCallout && (
        <div role="alert" className="rounded-[var(--radius-lg)] border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-accent-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="t-body text-accent-warning font-medium mb-1">Your business profile is incomplete</p>
            <p className="t-caption text-[var(--brand-text-muted)]">
              Add your address to unlock LocalBusiness schema on your homepage, /contact, and /about — the highest-value schema type for local businesses.
            </p>
            {workspaceId && (
              <Link
                to={adminPath(workspaceId, 'workspace-settings') + '?tab=business-profile'}
                className="t-caption text-accent-brand hover:text-accent-brand mt-2 inline-block"
              >
                Complete business profile →
              </Link>
            )}
          </div>
          <button
            onClick={dismissBpCallout}
            className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] flex-shrink-0"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Progress banner while streaming */}
      {loading && data && data.length > 0 && (
        <ProgressIndicator
          status="running"
          step="Generating schemas..."
          detail={progressMsg || undefined}
          onCancel={stopScan}
        />
      )}

      {/* Completion next steps */}
      {showNextSteps && data && data.length > 0 && !loading && (
        <NextStepsCard
          title={`Scan complete: ${data.length} pages with suggestions`}
          variant="success"
          onDismiss={() => setShowNextSteps(false)}
          staggerIndex={0}
          steps={[
            {
              label: 'Review suggestions',
              onClick: () => { setShowNextSteps(false); setTimeout(() => document.getElementById('schema-suggestions-list')?.scrollIntoView({ behavior: 'smooth' }), 150); },
              estimatedTime: '3 min',
            },
          ]}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="t-caption text-[var(--brand-text-muted)]">
            {data.length} pages · {totalTypes} schema types generated{loading ? ' (so far)' : ''}
            {snapshotDate && !loading && <span className="text-[var(--brand-text-muted)]"> · saved {new Date(snapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!loading && data.length > 0 && (
            <BulkPublishPanel
              dataCount={data.length}
              unpublishedCount={data.filter(p => !p.pageId.startsWith('cms-') && !published.has(p.pageId) && p.suggestedSchemas[0]?.template).length}
              bulkPublishing={bulkPublishing}
              bulkProgress={bulkProgress}
              sendingToClient={sendingToClient}
              sentToClient={sentToClient}
              loading={loading}
              onPublishAll={publishAllToWebflow}
              onSendToClient={sendSchemasToClient}
            />
          )}
          <div className="relative">
            <button
              onClick={fetchPages}
              disabled={loading || loadingPages}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingPages ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={Plus} size="sm" />} Add Page
            </button>
            {showPagePicker && (
              <PagePicker
                availablePages={availablePages}
                pageSearch={pageSearch}
                generatingSingle={generatingSingle}
                existingPageIds={new Set(data?.map(d => d.pageId) || [])}
                onPageSearchChange={setPageSearch}
                onSelectPage={generateSinglePage}
                onClose={() => { setShowPagePicker(false); setPageSearch(''); }}
              />
            )}
          </div>
          <button onClick={runScan} disabled={loading} className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <Icon as={RefreshCw} size="sm" /> Re-generate All
          </button>
        </div>
      </div>
      {generatingSingle && (
        <div className="flex items-center gap-2 px-4 py-2 bg-teal-500/10 border border-teal-500/20 rounded-[var(--radius-xl)]">
          <Icon as={Loader2} size="sm" className="animate-spin text-accent-brand" />
          <span className="t-caption text-accent-brand">Generating schema for page...</span>
        </div>
      )}

      {/* Pending schema approval batches sent to client */}
      {workspaceId && (
        <PendingApprovals
          workspaceId={workspaceId}
          refreshKey={approvalRefreshKey}
          nameFilter="Schema"
          onRetracted={() => setApprovalRefreshKey(k => k + 1)}
        />
      )}

      {/* Schema completeness widget — aggregates validationFindings and deep-links to fix locations */}
      <SchemaCompletenessWidget pages={data} workspaceId={workspaceId} />

      {/* Summary cards */}
      <div id="schema-suggestions-list" />
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[var(--surface-2)] p-4 border border-[var(--brand-border)]" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="t-caption text-[var(--brand-text-muted)] mb-1">Pages</div>
          <div className="text-2xl font-bold text-[var(--brand-text-bright)]">{data.length}</div>
          <div className="t-caption text-[var(--brand-text-muted)]">{totalTypes} @graph types total</div>
        </div>
        <div className="bg-[var(--surface-2)] p-4 border border-[var(--brand-border)]" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="t-caption text-[var(--brand-text-muted)] mb-1">Validated</div>
          <div className={cn('text-2xl font-bold', pagesWithErrors > 0 ? 'text-accent-warning' : 'text-accent-success')}>{data.length - pagesWithErrors}/{data.length}</div>
          <div className="t-caption text-[var(--brand-text-muted)]">
            {pagesWithErrors > 0 ? `${pagesWithErrors} with errors` : pagesWithWarnings > 0 ? `${pagesWithWarnings} with warnings` : 'all passing'}
            {fixesAvailable > 0 && ` · ${fixesAvailable} fix${fixesAvailable === 1 ? '' : 'es'} available`}
          </div>
        </div>
        <div className="bg-[var(--surface-2)] p-4 border border-[var(--brand-border)]" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="t-caption text-[var(--brand-text-muted)] mb-1">Existing Schemas</div>
          <div className="text-2xl font-bold text-accent-success">{pagesWithExisting}</div>
          <div className="t-caption text-[var(--brand-text-muted)]">pages already have JSON-LD</div>
        </div>
      </div>

      {/* Schema Impact Panel (C6) */}
      {impactData && impactData.totalDeployments > 0 && (
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature)' }}>
          <button
            onClick={() => setShowImpactDetail(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Icon as={BarChart3} size="md" className="text-accent-brand" />
              <span className="t-caption font-medium text-[var(--brand-text-bright)]">Schema Impact</span>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">{impactData.totalDeployments} deployments tracked</span>
            </div>
            <div className="flex items-center gap-3">
              {impactData.avgClicksDelta !== null && (
                <span className={cn('t-caption font-medium', impactData.avgClicksDelta >= 0 ? 'text-accent-success' : 'text-accent-danger')}>
                  {impactData.avgClicksDelta >= 0 ? '+' : ''}{impactData.avgClicksDelta} clicks
                </span>
              )}
              {impactData.avgPositionDelta !== null && (
                <span className={cn('t-caption font-medium', impactData.avgPositionDelta <= 0 ? 'text-accent-success' : 'text-accent-danger')}>
                  {impactData.avgPositionDelta <= 0 ? '' : '+'}{impactData.avgPositionDelta} pos
                </span>
              )}
              {impactData.tooRecent > 0 && (
                <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                  <Icon as={Clock} size="sm" /> {impactData.tooRecent} pending
                </span>
              )}
            </div>
          </button>
          {showImpactDetail && (
            <div className="border-t border-[var(--brand-border)]">
              {/* Aggregate stat cards */}
              <div className="grid grid-cols-4 gap-px bg-[var(--brand-border)]">
                {[
                  { label: 'Avg Clicks', value: impactData.avgClicksDelta, suffix: '', positive: (v: number) => v >= 0 },
                  { label: 'Avg Impressions', value: impactData.avgImpressionsDelta, suffix: '', positive: (v: number) => v >= 0 },
                  { label: 'Avg CTR', value: impactData.avgCtrDelta, suffix: '%', positive: (v: number) => v >= 0 },
                  { label: 'Avg Position', value: impactData.avgPositionDelta, suffix: '', positive: (v: number) => v <= 0 },
                ].map(stat => (
                  <div key={stat.label} className="bg-[var(--surface-2)] px-3 py-2.5">
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">{stat.label}</div>
                    {stat.value !== null ? (
                      <div className={cn('t-body font-bold', stat.positive(stat.value) ? 'text-accent-success' : 'text-accent-danger')}>
                        {stat.value >= 0 && stat.label !== 'Avg Position' ? '+' : ''}{stat.value}{stat.suffix}
                      </div>
                    ) : (
                      <div className="t-body text-[var(--brand-text-muted)]">—</div>
                    )}
                  </div>
                ))}
              </div>
              {/* Per-deployment list */}
              <div className="max-h-[240px] overflow-y-auto divide-y divide-[var(--brand-border)]/50">
                {impactData.deployments.map((d: SchemaDeploymentImpact) => (
                  <div key={d.change.id} className="flex items-center gap-3 px-4 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="t-caption text-[var(--brand-text)] truncate">{d.change.pageTitle || d.change.pageSlug || 'Unknown page'}</div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)]">
                        {new Date(d.change.changedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' · '}{d.daysSinceChange}d ago
                      </div>
                    </div>
                    {d.tooRecent ? (
                      <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]"><Icon as={Clock} size="sm" /> Too recent</span>
                    ) : d.before && d.after ? (
                      <div className="flex items-center gap-3 t-caption-sm">
                        <TrendBadge value={d.after.clicks - d.before.clicks} suffix="" showSign label="clicks" hideOnZero={false} />
                        <span className={d.after.position <= d.before.position ? 'text-accent-success' : 'text-accent-danger'}>
                          pos {d.after.position.toFixed(1)}
                        </span>
                      </div>
                    ) : (
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">No GSC data</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-[var(--brand-border)] t-caption-sm text-[var(--brand-text-muted)]">
                Compares 28-day GSC metrics before vs after each schema deployment. Changes &lt; 7 days old are marked pending.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit status summary bar */}
      {summary.total > 0 && (
        <div className="flex items-center gap-3 t-caption-sm text-[var(--brand-text-muted)] mb-2">
          <span className="text-[var(--brand-text)] font-medium">{summary.total} tracked</span>
          {summary.live > 0 && <><StatusBadge status="live" /><span className="text-accent-brand">{summary.live}</span></>}
          {summary.inReview > 0 && <><StatusBadge status="in-review" /><span className="text-accent-info">{summary.inReview}</span></>}
          {summary.approved > 0 && <><StatusBadge status="approved" /><span className="text-accent-success">{summary.approved}</span></>}
          {summary.rejected > 0 && <><StatusBadge status="rejected" /><span className="text-accent-danger">{summary.rejected}</span></>}
          {summary.issueDetected > 0 && <><StatusBadge status="issue-detected" /><span className="text-accent-warning">{summary.issueDetected}</span></>}
          {summary.fixProposed > 0 && <><StatusBadge status="fix-proposed" /><span className="text-accent-info">{summary.fixProposed}</span></>}
        </div>
      )}

      {/* Page list */}
      <div className="space-y-3">
        {data.map(page => {
          const schemaRecs = recsLoaded ? recsForPage(page.url || page.slug).filter(r => r.type === 'schema') : [];
          return (
            <SchemaPageCard
              key={page.pageId}
              page={page}
              isOpen={expanded.has(page.pageId)}
              isRegenLoading={regenerating.has(page.pageId)}
              editState={getState(page.pageId)}
              copiedId={copiedId}
              published={published.has(page.pageId)}
              publishing={publishing.has(page.pageId)}
              publishError={publishError[page.pageId]}
              manualDelivery={manualDelivery[page.pageId]}
              confirmPublish={confirmPublish === page.pageId}
              sentPage={sentPages.has(page.pageId)}
              sendingPage={sendingPage.has(page.pageId)}
              editingSchema={editingSchema.has(page.pageId)}
              editedSchemaJson={editedSchemaJson[page.pageId]}
              schemaParseError={schemaParseError[page.pageId]}
              showDiff={showDiff.has(page.pageId)}
              schemaRecs={schemaRecs}
              workspaceId={workspaceId}
              pageType={pageTypes[page.pageId] || 'auto'}
              isHomepage={!page.slug || page.slug === '/' || page.slug === 'index' || page.slug === 'home'}
              savingTemplate={savingTemplate}
              templateSaved={templateSaved}
              onPageTypeChange={(pid, t) => {
                setPageTypes(prev => ({ ...prev, [pid]: t }));
                // Persist to server (fire-and-forget)
                put(`/api/webflow/schema-page-types/${siteId}?workspaceId=${workspaceId || ''}`, { pageId: pid, pageType: t }).catch(() => {});
              }}
              onToggleExpand={toggleExpand}
              onRegenerate={regeneratePage}
              onToggleDiff={toggleDiff}
              onToggleSchemaEdit={toggleSchemaEdit}
              onSchemaJsonChange={handleSchemaJsonChange}
              onCopyTemplate={copyTemplate}
              onCopyJsonLd={copyJsonLd}
              onPublish={publishToWebflow}
              onConfirmPublish={setConfirmPublish}
              onSendToClient={sendSingleSchemaToClient}
              onSaveAsTemplate={saveAsTemplate}
              onRetract={async (pageId: string) => {
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
              }}
              retracting={retractingPages.has(page.pageId)}
              retracted={retractedPages.has(page.pageId)}
              getEffectiveSchema={getEffectiveSchema}
              siteId={siteId}
              onRestore={(pageId, restoredSchema) => {
                // Update local data with the restored schema
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
              }}
            />
          );
        })}
      </div>

      <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-blue-500/5 border border-blue-500/10">
        <Icon as={Info} size="md" className="text-accent-info flex-shrink-0 mt-0.5" />
        <div className="t-caption text-[var(--brand-text-muted)]">
          <strong className="text-[var(--brand-text-bright)]">How to use:</strong> Each page gets one unified <code className="text-accent-info">@graph</code> schema with cross-referenced types. Click <strong>Publish to Webflow</strong> to use the Custom Code API when supported, <strong>Copy script</strong> for manual custom code, or <strong>Copy JSON-LD</strong> for Webflow Page Settings -&gt; Schema markup. Existing custom code on your pages is never touched — only schema scripts are managed.
        </div>
      </div>
    </div>
  );
}
