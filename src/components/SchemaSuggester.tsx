import { useState } from 'react';
import { Link } from 'react-router-dom';
import { put } from '../api/client';
import type { FixContext } from '../App';
import {
  Loader2, CheckCircle,
  Info, Sparkles, RefreshCw, Plus, Database, HelpCircle,
  BookOpen, AlertTriangle, X,
} from 'lucide-react';
import type { BusinessProfileContact } from '../../shared/types/workspace.js';
import { useRecommendations } from '../hooks/useRecommendations';
import { Icon, cn } from './ui';
import { WorkflowStepper, ErrorState, ProgressIndicator, NextStepsCard } from './ui';
import { CmsTemplatePanel } from './schema/CmsTemplatePanel';
import { SchemaPageCard } from './schema/SchemaPageCard';
import { BulkPublishPanel } from './schema/BulkPublishPanel';
import { PagePicker } from './schema/PagePicker';
import { SchemaPlanPanel } from './schema/SchemaPlanPanel';
import { SchemaCompletenessWidget } from './schema/SchemaCompletenessWidget';
import { PendingApprovals } from './PendingApprovals';
import { SchemaWorkflowGuide } from './schema/SchemaWorkflowGuide';
import { useSchemaSuggesterGeneration } from './schema/useSchemaSuggesterGeneration';
import {
  MAX_SCHEMA_MAPPING_COLLECTIONS,
  useSchemaSuggesterCmsWorkflow,
} from './schema/useSchemaSuggesterCmsWorkflow';
import { SCHEMA_ROLE_INDEX, SCHEMA_ROLE_LABELS } from '../../shared/types/schema-plan';
import { adminPath } from '../routes.js';
import { useSchemaSuggesterPublishingWorkflow } from './schema/useSchemaSuggesterPublishingWorkflow';
import { SchemaImpactPanel, useSchemaImpactData } from './schema/SchemaImpactPanel';
import { SchemaEditStatusSummary, SchemaResultsSummary, summarizeSchemaResults } from './schema/SchemaResultsSummary';

type SchemaSubTab = 'generator' | 'guide';

interface Props {
  siteId: string;
  workspaceId?: string;
  fixContext?: FixContext | null;
  businessProfile?: BusinessProfileContact | null;
}

export function SchemaSuggester({ siteId, workspaceId, fixContext, businessProfile }: Props) {
  const [schemaSubTab, setSchemaSubTab] = useState<SchemaSubTab>('generator');
  const { forPage: recsForPage, loaded: recsLoaded } = useRecommendations(workspaceId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const {
    data,
    setData,
    loading,
    started,
    regenerating,
    scanError,
    progressMsg,
    showNextSteps,
    setShowNextSteps,
    showPagePicker,
    setShowPagePicker,
    availablePages,
    pageSearch,
    setPageSearch,
    loadingPages,
    generatingSingle,
    pageTypes,
    setPageTypes,
    snapshotDate,
    filteredInitialPages,
    runScan,
    stopScan,
    fetchPages,
    generateSinglePage,
    regeneratePage,
  } = useSchemaSuggesterGeneration({
    siteId,
    workspaceId,
    fixContext,
    onPageGenerated: pageId => {
      setExpanded(prev => new Set(prev).add(pageId));
      clearManualDeliveryForPage(pageId);
    },
  });

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

  const [showTypeGuide, setShowTypeGuide] = useState(false);
  const {
    showCmsPanel,
    setShowCmsPanel,
    cmsTemplatePages,
    loadingCmsPages,
    generatingCmsTemplate,
    cmsTemplateResult,
    publishingCmsTemplate,
    cmsPublished,
    cmsCopied,
    cmsError,
    cmsMappingError,
    savingCmsMapping,
    fieldMappingTargets,
    schemaMappingCollections,
    fetchCmsTemplatePages,
    generateCmsTemplate,
    publishCmsTemplate,
    copyCmsTemplate,
    saveCmsFieldMapping,
  } = useSchemaSuggesterCmsWorkflow({ siteId, workspaceId });
  const {
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
  } = useSchemaSuggesterPublishingWorkflow({ siteId, workspaceId, data, setData });
  const impactData = useSchemaImpactData(workspaceId);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const PAGE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'auto', label: 'Auto-detect' },
    ...Object.entries(SCHEMA_ROLE_LABELS).map(([value, label]) => ({ value, label })),
  ];

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

  const resultStats = summarizeSchemaResults(data);

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
            {data.length} pages · {resultStats.totalTypes} schema types generated{loading ? ' (so far)' : ''}
            {snapshotDate && !loading && <span className="text-[var(--brand-text-muted)]"> · saved {new Date(snapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!loading && data.length > 0 && (
            <BulkPublishPanel
              dataCount={data.length}
              unpublishedCount={unpublishedCount}
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

      <SchemaResultsSummary pages={data} stats={resultStats} />
      <SchemaImpactPanel impactData={impactData} />
      <SchemaEditStatusSummary summary={summary} />

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
              onRetract={retractSchema}
              retracting={retractingPages.has(page.pageId)}
              retracted={retractedPages.has(page.pageId)}
              getEffectiveSchema={getEffectiveSchema}
              siteId={siteId}
              onRestore={restoreSchema}
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
