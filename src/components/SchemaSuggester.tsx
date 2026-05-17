import { useState } from 'react';
import { put } from '../api/client';
import type { FixContext } from '../App';
import {
  Loader2, CheckCircle,
  Info, Sparkles, RefreshCw, Plus,
  BookOpen,
} from 'lucide-react';
import type { BusinessProfileContact } from '../../shared/types/workspace.js';
import { useRecommendations } from '../hooks/useRecommendations';
import { useSchemaGraphValidation } from '../hooks/admin/useSchemaValidation';
import { Icon, cn, Button } from './ui';
import { WorkflowStepper, ErrorState, ProgressIndicator, NextStepsCard } from './ui';
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
import { useSchemaSuggesterPublishingWorkflow } from './schema/useSchemaSuggesterPublishingWorkflow';
import { SchemaImpactPanel, useSchemaImpactData } from './schema/SchemaImpactPanel';
import { SchemaEditStatusSummary, SchemaResultsSummary, summarizeSchemaResults } from './schema/SchemaResultsSummary';
import {
  SchemaBusinessProfileCallout,
  SchemaCmsFieldMappingPanel,
  SchemaGeneratorHero,
  SchemaInitialPageTypePicker,
} from './schema/SchemaGeneratorSetup';

type SchemaSubTab = 'generator' | 'guide';

interface Props {
  siteId: string;
  workspaceId?: string;
  fixContext?: FixContext | null;
  businessProfile?: BusinessProfileContact | null;
  intelligenceProfile?: {
    industry?: string;
    targetAudience?: string;
  } | null;
}

type LocalBusinessIntent = 'unknown' | 'local' | 'non-local-saas';

function inferLocalBusinessIntent(
  businessProfile: BusinessProfileContact | null | undefined,
  intelligenceProfile: Props['intelligenceProfile'],
): LocalBusinessIntent {
  if (businessProfile?.address?.street || businessProfile?.address?.city) return 'local';
  const profileText = [
    intelligenceProfile?.industry,
    intelligenceProfile?.targetAudience,
  ].filter(Boolean).join(' ').toLowerCase();
  if (!profileText) return 'unknown';
  if (/\b(?:dental|dentist|clinic|medical|healthcare|restaurant|retail|salon|spa|law firm|real estate|local)\b/.test(profileText)) {
    return 'local';
  }
  if (/\b(?:saas|software|platform|developer|engineering|b2b|cloud|ai|artificial intelligence)\b/.test(profileText)) {
    return 'non-local-saas';
  }
  return 'unknown';
}

export function SchemaSuggester({ siteId, workspaceId, fixContext, businessProfile, intelligenceProfile }: Props) {
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
    setSinglePageTypeOverrides,
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
  const graphValidationQuery = useSchemaGraphValidation(siteId, workspaceId, started && !!data && data.length > 0 && !loading);
  const graphValidation = graphValidationQuery.data ?? null;
  const bulkPublishBlocked = graphValidation?.status === 'errors';

  // Business-profile callout dismiss state
  const dismissedKey = workspaceId ? `schema-bp-callout-dismissed-${workspaceId}` : null;
  const [calloutDismissed, setCalloutDismissed] = useState(() =>
    dismissedKey ? localStorage.getItem(dismissedKey) === '1' : true,
  );
  const dismissBpCallout = () => {
    if (dismissedKey) localStorage.setItem(dismissedKey, '1');
    setCalloutDismissed(true);
  };
  const localBusinessIntent = inferLocalBusinessIntent(businessProfile, intelligenceProfile);

  const {
    cmsMappingError,
    savingCmsMapping,
    fieldMappingTargets,
    schemaMappingCollections,
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
  } = useSchemaSuggesterPublishingWorkflow({ siteId, workspaceId, data, setData, bulkPublishBlocked });
  const impactData = useSchemaImpactData(workspaceId);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const schemaTabBar = (
    <div className="flex items-center gap-1 border-b border-[var(--brand-border)] pb-0 mb-4">
      {([
        { id: 'generator' as SchemaSubTab, label: 'Generator', icon: Sparkles },
        { id: 'guide' as SchemaSubTab, label: 'Workflow Guide', icon: BookOpen },
      ]).map(t => (
        <Button
          key={t.id}
          onClick={() => setSchemaSubTab(t.id)}
          variant="ghost"
          size="sm"
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 t-caption font-medium border-b-2 transition-colors -mb-px',
            schemaSubTab === t.id
              ? 'border-teal-500 text-accent-brand'
              : 'border-transparent text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
          )}
        >
          <Icon as={t.icon} size="md" />
          {t.label}
        </Button>
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
        <SchemaGeneratorHero
          onRunScan={runScan}
        />
        <SchemaPlanPanel siteId={siteId} workspaceId={workspaceId} />
        <SchemaBusinessProfileCallout
          businessProfile={businessProfile}
          localBusinessIntent={localBusinessIntent}
          dismissed={calloutDismissed}
          workspaceId={workspaceId}
          onDismiss={dismissBpCallout}
        />
        <SchemaCmsFieldMappingPanel
          collections={schemaMappingCollections}
          cmsMappingError={cmsMappingError}
          savingCmsMapping={savingCmsMapping}
          fieldMappingTargets={fieldMappingTargets}
          onSaveCmsFieldMapping={saveCmsFieldMapping}
          maxCollections={MAX_SCHEMA_MAPPING_COLLECTIONS}
        />
        {generatingSingle && (
          <div className="flex items-center gap-2 px-4 py-2 bg-teal-500/10 border border-teal-500/20 rounded-[var(--radius-xl)]">
            <Icon as={Loader2} size="md" className="animate-spin text-accent-brand" />
            <span className="t-caption text-accent-brand">Generating schema for page...</span>
          </div>
        )}
        <SchemaInitialPageTypePicker
          availablePages={availablePages}
          filteredPages={filteredInitialPages}
          pageSearch={pageSearch}
          pageTypes={pageTypes}
          loadingPages={loadingPages}
          generatingSingle={generatingSingle}
          onPageSearchChange={setPageSearch}
          onPageTypeSelect={(pageId, pageType) => {
            setPageTypes(prev => ({ ...prev, [pageId]: pageType }));
            setSinglePageTypeOverrides(prev => ({ ...prev, [pageId]: pageType }));
          }}
          onGenerateSinglePage={generateSinglePage}
        />
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
        <Button onClick={runScan} variant="secondary" size="sm" icon={RefreshCw} className="mt-2">
          Re-scan
        </Button>
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

      <SchemaBusinessProfileCallout
        businessProfile={businessProfile}
        localBusinessIntent={localBusinessIntent}
        dismissed={calloutDismissed}
        workspaceId={workspaceId}
        onDismiss={dismissBpCallout}
      />

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
              graphValidation={graphValidation}
              graphValidationLoading={graphValidationQuery.isFetching}
            />
          )}
          <div className="relative">
            <Button
              onClick={fetchPages}
              disabled={loading || loadingPages}
              variant="secondary"
              size="sm"
              icon={loadingPages ? Loader2 : Plus}
              className={loadingPages ? '[&>svg]:animate-spin' : undefined}
            >
              Add Page
            </Button>
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
          <Button onClick={runScan} disabled={loading} variant="secondary" size="sm" icon={RefreshCw}>
            Re-generate All
          </Button>
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
