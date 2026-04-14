import { useState, useEffect, useRef } from 'react';
import { post, put, getSafe } from '../api/client';
import { schema as schemaApi, schemaImpact as schemaImpactApi, type SchemaImpactData, type SchemaDeploymentImpact } from '../api/seo';
import type { FixContext } from '../App';
import { useSchemaSnapshot, useWebflowPages } from '../hooks/admin';
import {
  Loader2, CheckCircle,
  Info, Sparkles, RefreshCw, Plus, Database, HelpCircle,
  TrendingUp, TrendingDown, Clock, BarChart3, BookOpen,
} from 'lucide-react';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { useRecommendations } from '../hooks/useRecommendations';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { StatusBadge } from './ui/StatusBadge';
import { WorkflowStepper, ErrorState, ProgressIndicator, NextStepsCard } from './ui';
import { CmsTemplatePanel } from './schema/CmsTemplatePanel';
import { SchemaPageCard } from './schema/SchemaPageCard';
import { BulkPublishPanel } from './schema/BulkPublishPanel';
import { PagePicker } from './schema/PagePicker';
import { SchemaPlanPanel } from './schema/SchemaPlanPanel';
import { PendingApprovals } from './PendingApprovals';
import { SchemaWorkflowGuide } from './schema/SchemaWorkflowGuide';
import { SCHEMA_ROLE_INDEX } from '../../shared/types/schema-plan';

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
  richResultsEligibility?: RichResultEligibility[];
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

interface Props {
  siteId: string;
  workspaceId?: string;
  fixContext?: FixContext | null;
}

export function SchemaSuggester({ siteId, workspaceId, fixContext }: Props) {
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

  // Schema editing state — stores edited JSON string per pageId
  const [editingSchema, setEditingSchema] = useState<Set<string>>(new Set());
  const [editedSchemaJson, setEditedSchemaJson] = useState<Record<string, string>>({});
  const [schemaParseError, setSchemaParseError] = useState<Record<string, string>>({});

  // Unified page edit states
  const { getState, refresh: refreshStates, summary } = usePageEditStates(workspaceId);

  // Load saved schema snapshot — React Query
  const { data: snapshotData } = useSchemaSnapshot(siteId);
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  // Hydrate local state from snapshot query when it arrives
  useEffect(() => {
    if (snapshotData && snapshotData.results.length > 0 && !data) {
      setData(snapshotData.results as SchemaPageSuggestion[]);
      setSnapshotDate(snapshotData.createdAt);
      setStarted(true);
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
    }
  }, [snapshotData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load persisted page types from server on mount
  useEffect(() => {
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
  const { data: fetchedPages = [] } = useWebflowPages(siteId);
  useEffect(() => {
    if (fetchedPages.length > 0 && availablePages.length === 0) {
      setAvailablePages(fetchedPages);
    }
  }, [fetchedPages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stream partial results from background job via WebSocket
  useEffect(() => {
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
      const pages = await getSafe<Array<{ _id?: string; id?: string; title?: string; slug?: string }>>(`/api/webflow/pages/${siteId}`, []);
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
      const result = await post<SchemaPageSuggestion>(`/api/webflow/schema-suggestions/${siteId}/page`, { pageId, pageType: pt && pt !== 'auto' ? pt : undefined });
      setData(prev => {
        if (!prev) return [result];
        const exists = prev.findIndex(p => p.pageId === pageId);
        if (exists >= 0) return prev.map(p => p.pageId === pageId ? result : p);
        return [...prev, result];
      });
      setExpanded(prev => new Set(prev).add(pageId));
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
      const result = await post<SchemaPageSuggestion>(`/api/webflow/schema-suggestions/${siteId}/page`, { pageId });
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
    setConfirmPublish(null);
    try {
      const pageData = data?.find(p => p.pageId === pageId);
      const isHomepage = !pageData?.slug || pageData.slug === '/' || pageData.slug === 'index' || pageData.slug === 'home';
      await post(`/api/webflow/schema-publish/${siteId}`, { pageId, schema, publishAfter: true, isHomepage });
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
      await put(`/api/webflow/schema-template/${siteId}`, { organizationNode: orgNode, websiteNode });
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
      const pages = await getSafe<CmsTemplatePage[]>(`/api/webflow/cms-template-pages/${siteId}`, []);
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
      const result = await post<CmsTemplateResult>(`/api/webflow/schema-cms-template/${siteId}`, { collectionId: page.collectionId });
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
      await post(`/api/webflow/schema-cms-template/${siteId}/publish`, {
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

  const PAGE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'auto', label: 'Auto-detect' },
    { value: 'homepage', label: 'Homepage' },
    { value: 'pillar', label: 'Pillar / Product Page' },
    { value: 'service', label: 'Service Page' },
    { value: 'audience', label: 'Audience / Use Case' },
    { value: 'lead-gen', label: 'Lead-Gen / Conversion' },
    { value: 'blog', label: 'Blog Post' },
    { value: 'about', label: 'About / Team' },
    { value: 'contact', label: 'Contact' },
    { value: 'location', label: 'Location' },
    { value: 'product', label: 'Product' },
    { value: 'partnership', label: 'Partnership' },
    { value: 'faq', label: 'FAQ' },
    { value: 'case-study', label: 'Case Study' },
    { value: 'comparison', label: 'Comparison' },
    { value: 'generic', label: 'General Page' },
  ];

  const filteredInitialPages = availablePages.filter(
    p => !pageSearch || p.title.toLowerCase().includes(pageSearch.toLowerCase()) || p.slug.toLowerCase().includes(pageSearch.toLowerCase())
  );

  const schemaTabBar = (
    <div className="flex items-center gap-1 border-b border-zinc-800 pb-0 mb-4">
      {([
        { id: 'generator' as SchemaSubTab, label: 'Generator', icon: Sparkles },
        { id: 'guide' as SchemaSubTab, label: 'Workflow Guide', icon: BookOpen },
      ]).map(t => (
        <button
          key={t.id}
          onClick={() => setSchemaSubTab(t.id)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
            schemaSubTab === t.id
              ? 'border-teal-500 text-teal-300'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <t.icon className="w-3.5 h-3.5" />
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
          <div className="w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
            <Sparkles className="w-7 h-7 text-teal-400" />
          </div>
          <div className="text-center space-y-1.5">
            <p className="text-sm font-medium text-zinc-200">Schema Generator</p>
            <p className="text-xs text-zinc-500 max-w-sm">Generate optimized JSON-LD structured data. Optionally set page types below for more accurate schemas, then generate.</p>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={runScan}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors"
            >
              <Sparkles className="w-4 h-4" /> Generate All Pages
            </button>
            <button
              onClick={fetchCmsTemplatePages}
              disabled={loadingCmsPages}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30 transition-colors disabled:opacity-50"
            >
              {loadingCmsPages ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />} CMS Templates
            </button>
          </div>
        </div>
        <SchemaPlanPanel siteId={siteId} />
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
        {generatingSingle && (
          <div className="flex items-center gap-2 px-4 py-2 bg-teal-500/10 border border-teal-500/20 rounded-xl">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
            <span className="text-xs text-teal-300">Generating schema for page...</span>
          </div>
        )}
        {/* Page list with type selectors */}
        {loadingPages ? (
          <div className="flex items-center justify-center py-6 gap-2 text-zinc-500 text-xs">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading pages...
          </div>
        ) : availablePages.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">{availablePages.length} pages — set page types for better AI prompts</span>
              <button
                onClick={() => setShowTypeGuide(v => !v)}
                className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Page Type Guide"
              >
                <HelpCircle className="w-3 h-3" />
                Guide
              </button>
            </div>
              <input
                type="text"
                value={pageSearch}
                onChange={e => setPageSearch(e.target.value)}
                placeholder="Filter pages..."
                className="px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 w-48 focus:outline-none focus:border-zinc-600"
              />
            </div>
            {showTypeGuide && (
              <div className="bg-zinc-950/50 rounded-lg border border-zinc-800 overflow-hidden max-h-[280px] overflow-y-auto">
                {PAGE_TYPE_OPTIONS.filter(o => o.value !== 'auto').map(opt => {
                  const info = SCHEMA_ROLE_INDEX[opt.value as keyof typeof SCHEMA_ROLE_INDEX];
                  if (!info) return null;
                  return (
                    <div key={opt.value} className="px-3 py-2 border-b border-zinc-800/50 last:border-b-0">
                      <span className="text-[11px] font-medium text-zinc-300">{opt.label}</span>
                      <p className="text-[11px] text-zinc-500 leading-relaxed">{info.description}</p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {info.examples.map((ex: string) => (
                          <code key={ex} className="text-[9px] text-zinc-600 bg-zinc-800/60 px-1 py-0.5 rounded font-mono">{ex}</code>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="bg-zinc-900 border border-zinc-800 overflow-hidden max-h-[400px] overflow-y-auto" style={{ borderRadius: '10px 24px 10px 24px' }}>
              {filteredInitialPages.map(p => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800/50 last:border-b-0 hover:bg-zinc-800/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-300 truncate">{p.title}</div>
                    <div className="text-[11px] text-zinc-500 truncate">/{p.slug}</div>
                  </div>
                  <select
                    value={pageTypes[p.id] || 'auto'}
                    onChange={e => setPageTypes(prev => ({ ...prev, [p.id]: e.target.value }))}
                    className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-300 focus:outline-none focus:border-teal-500 cursor-pointer"
                  >
                    {PAGE_TYPE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => generateSinglePage(p.id)}
                    disabled={generatingSingle === p.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] text-teal-300 bg-teal-600/10 border border-teal-500/20 hover:bg-teal-600/20 transition-colors disabled:opacity-50"
                  >
                    {generatingSingle === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
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
        <CheckCircle className="w-8 h-8 text-emerald-400/80" />
        <p className="text-zinc-400 text-sm">No schema suggestions needed</p>
        <button onClick={runScan} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors mt-2">
          <RefreshCw className="w-3 h-3" /> Re-scan
        </button>
      </div>
    );
  }

  const pagesWithExisting = data.filter(p => p.existingSchemas.length > 0).length;
  const pagesWithErrors = data.filter(p => (p.validationErrors?.length || 0) > 0).length;
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
      <SchemaPlanPanel siteId={siteId} />

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
          <span className="text-xs text-zinc-500">
            {data.length} pages · {totalTypes} schema types generated{loading ? ' (so far)' : ''}
            {snapshotDate && !loading && <span className="text-zinc-500"> · saved {new Date(snapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
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
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingPages ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add Page
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
          <button onClick={runScan} disabled={loading} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <RefreshCw className="w-3 h-3" /> Re-generate All
          </button>
        </div>
      </div>
      {generatingSingle && (
        <div className="flex items-center gap-2 px-4 py-2 bg-teal-500/10 border border-teal-500/20 rounded-xl">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
          <span className="text-xs text-teal-300">Generating schema for page...</span>
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

      {/* Summary cards */}
      <div id="schema-suggestions-list" />
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 p-4 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="text-xs text-zinc-500 mb-1">Pages</div>
          <div className="text-2xl font-bold text-zinc-200">{data.length}</div>
          <div className="text-xs text-zinc-500">{totalTypes} @graph types total</div>
        </div>
        <div className="bg-zinc-900 p-4 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="text-xs text-zinc-500 mb-1">Validated</div>
          <div className={`text-2xl font-bold ${pagesWithErrors > 0 ? 'text-amber-400/80' : 'text-emerald-400/80'}`}>{data.length - pagesWithErrors}/{data.length}</div>
          <div className="text-xs text-zinc-500">{pagesWithErrors > 0 ? `${pagesWithErrors} with warnings` : 'all passing'}</div>
        </div>
        <div className="bg-zinc-900 p-4 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="text-xs text-zinc-500 mb-1">Existing Schemas</div>
          <div className="text-2xl font-bold text-emerald-400/80">{pagesWithExisting}</div>
          <div className="text-xs text-zinc-500">pages already have JSON-LD</div>
        </div>
      </div>

      {/* Schema Impact Panel (C6) */}
      {impactData && impactData.totalDeployments > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <button
            onClick={() => setShowImpactDetail(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-teal-400" />
              <span className="text-xs font-medium text-zinc-200">Schema Impact</span>
              <span className="text-[10px] text-zinc-500">{impactData.totalDeployments} deployments tracked</span>
            </div>
            <div className="flex items-center gap-3">
              {impactData.avgClicksDelta !== null && (
                <span className={`text-xs font-medium ${impactData.avgClicksDelta >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                  {impactData.avgClicksDelta >= 0 ? '+' : ''}{impactData.avgClicksDelta} clicks
                </span>
              )}
              {impactData.avgPositionDelta !== null && (
                <span className={`text-xs font-medium ${impactData.avgPositionDelta <= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                  {impactData.avgPositionDelta <= 0 ? '' : '+'}{impactData.avgPositionDelta} pos
                </span>
              )}
              {impactData.tooRecent > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                  <Clock className="w-3 h-3" /> {impactData.tooRecent} pending
                </span>
              )}
            </div>
          </button>
          {showImpactDetail && (
            <div className="border-t border-zinc-800">
              {/* Aggregate stat cards */}
              <div className="grid grid-cols-4 gap-px bg-zinc-800">
                {[
                  { label: 'Avg Clicks', value: impactData.avgClicksDelta, suffix: '', positive: (v: number) => v >= 0 },
                  { label: 'Avg Impressions', value: impactData.avgImpressionsDelta, suffix: '', positive: (v: number) => v >= 0 },
                  { label: 'Avg CTR', value: impactData.avgCtrDelta, suffix: '%', positive: (v: number) => v >= 0 },
                  { label: 'Avg Position', value: impactData.avgPositionDelta, suffix: '', positive: (v: number) => v <= 0 },
                ].map(stat => (
                  <div key={stat.label} className="bg-zinc-900 px-3 py-2.5">
                    <div className="text-[10px] text-zinc-500">{stat.label}</div>
                    {stat.value !== null ? (
                      <div className={`text-sm font-bold ${stat.positive(stat.value) ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                        {stat.value >= 0 && stat.label !== 'Avg Position' ? '+' : ''}{stat.value}{stat.suffix}
                      </div>
                    ) : (
                      <div className="text-sm text-zinc-600">—</div>
                    )}
                  </div>
                ))}
              </div>
              {/* Per-deployment list */}
              <div className="max-h-[240px] overflow-y-auto divide-y divide-zinc-800/50">
                {impactData.deployments.map((d: SchemaDeploymentImpact) => (
                  <div key={d.change.id} className="flex items-center gap-3 px-4 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-zinc-300 truncate">{d.change.pageTitle || d.change.pageSlug || 'Unknown page'}</div>
                      <div className="text-[10px] text-zinc-600">
                        {new Date(d.change.changedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' · '}{d.daysSinceChange}d ago
                      </div>
                    </div>
                    {d.tooRecent ? (
                      <span className="flex items-center gap-1 text-[10px] text-zinc-500"><Clock className="w-3 h-3" /> Too recent</span>
                    ) : d.before && d.after ? (
                      <div className="flex items-center gap-3 text-[11px]">
                        <span className={d.after.clicks >= d.before.clicks ? 'text-emerald-400/80' : 'text-red-400/80'}>
                          {d.after.clicks >= d.before.clicks ? <TrendingUp className="w-3 h-3 inline" /> : <TrendingDown className="w-3 h-3 inline" />}
                          {' '}{d.after.clicks - d.before.clicks >= 0 ? '+' : ''}{d.after.clicks - d.before.clicks} clicks
                        </span>
                        <span className={d.after.position <= d.before.position ? 'text-emerald-400/80' : 'text-red-400/80'}>
                          pos {d.after.position.toFixed(1)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-zinc-600">No GSC data</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500">
                Compares 28-day GSC metrics before vs after each schema deployment. Changes &lt; 7 days old are marked pending.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit status summary bar */}
      {summary.total > 0 && (
        <div className="flex items-center gap-3 text-[11px] text-zinc-500 mb-2">
          <span className="text-zinc-400 font-medium">{summary.total} tracked</span>
          {summary.live > 0 && <><StatusBadge status="live" /><span className="text-teal-400">{summary.live}</span></>}
          {summary.inReview > 0 && <><StatusBadge status="in-review" /><span className="text-purple-400">{summary.inReview}</span></>}
          {summary.approved > 0 && <><StatusBadge status="approved" /><span className="text-emerald-400/80">{summary.approved}</span></>}
          {summary.rejected > 0 && <><StatusBadge status="rejected" /><span className="text-red-400/80">{summary.rejected}</span></>}
          {summary.issueDetected > 0 && <><StatusBadge status="issue-detected" /><span className="text-amber-400/80">{summary.issueDetected}</span></>}
          {summary.fixProposed > 0 && <><StatusBadge status="fix-proposed" /><span className="text-blue-400">{summary.fixProposed}</span></>}
        </div>
      )}

      {/* Page list */}
      <div className="space-y-3">
        {data.map(page => {
          const schemaRecs = recsLoaded ? recsForPage(page.slug).filter(r => r.type === 'schema') : [];
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
              onPublish={publishToWebflow}
              onConfirmPublish={setConfirmPublish}
              onSendToClient={sendSingleSchemaToClient}
              onSaveAsTemplate={saveAsTemplate}
              onRetract={async (pageId: string) => {
                setRetractingPages(prev => new Set(prev).add(pageId));
                try {
                  await schemaApi.retract(siteId, pageId);
                  setRetractedPages(prev => new Set(prev).add(pageId));
                  setPublished(prev => { const n = new Set(prev); n.delete(pageId); return n; });
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
              }}
            />
          );
        })}
      </div>

      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/10">
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-zinc-400">
          <strong className="text-zinc-300">How to use:</strong> Each page gets one unified <code className="text-blue-300">@graph</code> schema with cross-referenced types. Click <strong>Publish to Webflow</strong> to inject it directly into the page's <code className="text-blue-300">&lt;head&gt;</code> via the Custom Code API, or <strong>Copy</strong> to paste it manually. Existing custom code on your pages is never touched — only schema scripts are managed.
        </div>
      </div>
    </div>
  );
}
