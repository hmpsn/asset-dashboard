// @ds-rebuilt
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, FileJson, Send, ShieldCheck } from 'lucide-react';
import type { BusinessProfileContact } from '../../../shared/types/workspace';
import type { FixContext } from '../../types/fix-context';
import { mutationErrorMessage } from './schemaMutationFeedback';
import { recommendationAppliesToPage } from '../../hooks/useRecommendations';
import { useAdminRecommendationSet } from '../../hooks/admin/useAdminRecommendations';
import { useSchemaGraphValidation, useSchemaValidations } from '../../hooks/admin/useSchemaValidation';
import { MAX_SCHEMA_MAPPING_COLLECTIONS, useSchemaSuggesterCmsWorkflow } from '../schema/useSchemaSuggesterCmsWorkflow';
import { useSchemaSuggesterGeneration } from '../schema/useSchemaSuggesterGeneration';
import { useSchemaSuggesterPublishingWorkflow } from '../schema/useSchemaSuggesterPublishingWorkflow';
import { useAdminSchemaImpact, useSaveSchemaPageType } from '../../hooks/admin/useAdminSchema';
import { useToast } from '../Toast';
import { PendingApprovals } from '../PendingApprovals';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  FormSelect,
  FormTextarea,
  GroupBlock,
  Icon,
  InlineBanner,
  MetricTile,
  NextStepsCard,
  ProgressIndicator,
  SearchField,
  SectionCard,
  Skeleton,
  type DataColumn,
} from '../ui';
import { SCHEMA_PAGE_TYPE_OPTIONS } from '../schema/schemaPageTypeOptions';
import { SchemaPageDrawer } from './SchemaPageDrawer';
import { SchemaPagePickerDrawer } from './SchemaPagePickerDrawer';
import { SchemaPageTable } from './SchemaPageTable';
import {
  SchemaBusinessProfilePanel,
  SchemaCmsMappingPanel,
  SchemaCompletenessPanel,
  SchemaGeneratorEmptySetup,
  SchemaHowToFooter,
  SchemaImpactPanel,
  SchemaInventoryAbsentBanner,
  SchemaSitePlanBridge,
  inferLocalBusinessIntent,
} from './SchemaSupportPanels';
import {
  formatInteger,
  summarizeSchemaPages,
  validationStatusForPage,
} from './schemaFormatters';
import { SchemaWorkflowStrip } from './SchemaWorkflowStrip';

interface GeneratorLensProps {
  siteId: string;
  workspaceId: string;
  fixContext: FixContext | null;
  businessProfile?: BusinessProfileContact | null;
  intelligenceProfile?: {
    industry?: string;
    targetAudience?: string;
  } | null;
}

function EmptyIcon({ className }: { className?: string }) {
  return <Icon as={FileJson} className={className} />;
}

function safeLocalStorageGet(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(key);
}

function safeLocalStorageSet(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, value);
}

export function GeneratorLens({
  siteId,
  workspaceId,
  fixContext,
  businessProfile,
  intelligenceProfile,
}: GeneratorLensProps) {
  const { toast } = useToast();
  const recommendations = useAdminRecommendationSet(workspaceId, { enabled: !!workspaceId });
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [pageTypeErrors, setPageTypeErrors] = useState<Record<string, string>>({});
  const [bulkSendNote, setBulkSendNote] = useState('');
  const [bulkNoteOpen, setBulkNoteOpen] = useState(false);
  const dismissedKey = `schema-bp-callout-dismissed-${workspaceId}`;
  const [calloutDismissed, setCalloutDismissed] = useState(() => safeLocalStorageGet(dismissedKey) === '1');
  const savePageType = useSaveSchemaPageType(siteId, workspaceId);

  const onPageGeneratedRef = useRef<(pageId: string) => void>(() => {});
  const onPageGenerated = useCallback((pageId: string) => {
    onPageGeneratedRef.current(pageId);
  }, []);

  const generation = useSchemaSuggesterGeneration({
    siteId,
    workspaceId,
    fixContext,
    onPageGenerated,
  });

  const graphValidationQuery = useSchemaGraphValidation(
    siteId,
    workspaceId,
    generation.started && !!generation.data && generation.data.length > 0 && !generation.loading,
  );
  const graphValidation = graphValidationQuery.data ?? null;
  const bulkPublishBlocked = graphValidation?.status === 'errors';
  const validationsQuery = useSchemaValidations(siteId, workspaceId);
  const validationStatusByPageId = useMemo(() => new Map(
    (validationsQuery.data ?? []).map((record) => [record.pageId, record.status] as const),
  ), [validationsQuery.data]);

  const cmsWorkflow = useSchemaSuggesterCmsWorkflow({ siteId, workspaceId });

  const publishing = useSchemaSuggesterPublishingWorkflow({
    siteId,
    workspaceId,
    data: generation.data,
    setData: generation.setData,
    bulkPublishBlocked,
  });

  const impactQuery = useAdminSchemaImpact(workspaceId);

  onPageGeneratedRef.current = (pageId: string) => {
    setSelectedPageId(pageId);
    publishing.clearManualDeliveryForPage(pageId);
    publishing.clearManualEditForPage(pageId);
  };

  const pages = generation.data ?? [];
  const selectedPage = pages.find((page) => page.pageId === selectedPageId) ?? null;
  const recommendationRows = useMemo(() => recommendations.data?.recommendations ?? [], [recommendations.data?.recommendations]);
  const selectedPageSchemaRecs = useMemo(() => {
    if (!selectedPage || !recommendations.isSuccess) return [];
    const pageIdentity = selectedPage.url || selectedPage.slug || selectedPage.publishedPath || '';
    if (!pageIdentity) return [];
    return recommendationRows
      .filter((recommendation) => recommendation.type === 'schema')
      .filter((recommendation) => recommendationAppliesToPage(recommendation, pageIdentity));
  }, [recommendationRows, recommendations.isSuccess, selectedPage]);
  const stats = useMemo(() => summarizeSchemaPages(pages), [pages]);
  const localBusinessIntent = inferLocalBusinessIntent(businessProfile, intelligenceProfile);

  useEffect(() => {
    if (publishing.sentToClient) toast('Schema batch sent to client', 'success');
  }, [publishing.sentToClient, toast]);

  const handleDismissCallout = () => {
    safeLocalStorageSet(dismissedKey, '1');
    setCalloutDismissed(true);
  };

  const handleRunScan = () => {
    publishing.clearAllManualEdits();
    toast('Schema generation started', 'info');
    void generation.runScan();
  };

  const handlePublishAll = () => {
    toast('Bulk schema publish started', 'info');
    void publishing.publishAllToWebflow();
  };

  const handleSendBatchToClient = (note?: string) => {
    toast('Sending schema batch to client', 'info');
    void publishing.sendSchemasToClient(note);
  };

  const handlePageTypeChange = (pageId: string, nextType: string) => {
    const priorType = generation.pageTypes[pageId];
    generation.setPageTypes((prev) => ({ ...prev, [pageId]: nextType }));
    setPageTypeErrors((prev) => {
      const next = { ...prev };
      delete next[pageId];
      return next;
    });
    savePageType.mutateAsync({ pageId, pageType: nextType }).catch((error: unknown) => {
      const message = mutationErrorMessage(error, 'Page type not saved. Try again.');
      setPageTypeErrors((prev) => ({ ...prev, [pageId]: message }));
      generation.setPageTypes((prev) => {
        const next = { ...prev };
        if (priorType !== undefined) next[pageId] = priorType;
        else delete next[pageId];
        return next;
      });
      toast(message, 'error');
    });
  };

  const initialInventoryRows = generation.filteredInitialPages.map((page) => ({
    id: page.id,
    page,
    title: page.title || 'Untitled page',
    slug: page.slug || '',
    pageType: generation.pageTypes[page.id] || 'auto',
  }));

  const initialInventoryColumns: DataColumn[] = [
    {
      key: 'title',
      label: 'Page',
      width: 'minmax(220px,1fr)',
      render: (_value, row) => (
        <div className="min-w-0">
          <div className="truncate t-ui text-[var(--brand-text-bright)]">{row.title as string}</div>
          <div className="truncate t-caption-sm text-[var(--brand-text-muted)]">/{row.slug as string}</div>
        </div>
      ),
    },
    {
      key: 'pageType',
      label: 'Type',
      width: '190px',
      render: (_value, row) => (
        <div onClick={(event) => event.stopPropagation()}>
          <FormSelect
            value={row.pageType as string}
            onChange={(value) => {
              generation.setPageTypes((prev) => ({ ...prev, [row.id as string]: value }));
              generation.setSinglePageTypeOverrides((prev) => ({ ...prev, [row.id as string]: value }));
            }}
            options={SCHEMA_PAGE_TYPE_OPTIONS}
            aria-label={`Page type for ${row.title as string}`}
          />
        </div>
      ),
    },
    {
      key: 'id',
      label: 'Action',
      width: '130px',
      align: 'right',
      render: (_value, row) => {
        const loading = generation.generatingSingle === row.id;
        return (
          <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
            <Button
              size="sm"
              variant="secondary"
              loading={loading}
              onClick={() => {
                toast('Single-page schema generation started', 'info');
                void generation.generateSinglePage(row.id as string);
              }}
            >
              {!loading && <Icon as={FileJson} size="sm" />}
              Generate
            </Button>
          </div>
        );
      },
    },
  ];

  if (!generation.started && generation.snapshotLoading) {
    return (
      <div className="flex flex-col gap-5" aria-label="Loading saved schema snapshot">
        <Skeleton className="h-[64px] w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
        <Skeleton className="h-[260px] w-full" />
      </div>
    );
  }

  if (generation.scanError) {
    return (
      <ErrorState
        type="data"
        title="Schema scan failed"
        message={generation.scanError}
        action={{ label: 'Scan again', onClick: handleRunScan }}
        className="min-h-[420px]"
      />
    );
  }

  if (generation.loading && pages.length === 0) {
    return (
      <div className="flex flex-col gap-[14px]">
        <SchemaWorkflowStrip loading />
        <ProgressIndicator
          status="running"
          step="Scanning schema opportunities..."
          detail={generation.progressMsg || undefined}
          onCancel={generation.stopScan}
        />
      </div>
    );
  }

  const existingPageIds = new Set(pages.map((page) => page.pageId));
  const graphErrorCount = graphValidation?.findings.filter((finding) => finding.severity === 'error').length ?? 0;
  const graphWarningCount = graphValidation?.findings.filter((finding) => finding.severity === 'warning').length ?? 0;
  const readinessTitle = stats.pagesWithErrors > 0
    ? `${formatInteger(stats.pagesWithErrors)} generated page${stats.pagesWithErrors === 1 ? ' needs' : 's need'} schema fixes.`
    : `${formatInteger(stats.pages)} generated page${stats.pages === 1 ? ' is' : 's are'} ready for review.`;
  const readinessDetail = `${formatInteger(stats.totalGraphTypes)} generated @graph types are available in this snapshot. Coverage remains pending until the next trusted crawl.`;
  const bulkTitle = bulkPublishBlocked
    ? 'Bulk publish is paused by graph validation.'
    : publishing.unpublishedCount > 0
      ? `${formatInteger(publishing.unpublishedCount)} publishable page${publishing.unpublishedCount === 1 ? ' is' : 's are'} ready.`
      : 'Every generated page has a publish state.';
  const bulkDetail = bulkPublishBlocked
    ? `${formatInteger(graphErrorCount)} graph error${graphErrorCount === 1 ? '' : 's'} must be fixed before bulk publish.`
    : graphValidation?.status === 'warnings'
      ? `${formatInteger(graphWarningCount)} graph warning${graphWarningCount === 1 ? '' : 's'} found; publish and client review remain available.`
      : 'Publish the batch directly, or send the same reviewed schema to the client first.';

  return (
    <div className="flex flex-col gap-[14px]">

      {!generation.started && (
        <>
          <SchemaGeneratorEmptySetup onRunScan={handleRunScan} />
          {generation.loadingPages ? (
            <Skeleton className="h-[220px] w-full" />
          ) : generation.availablePages.length > 0 && (
            <GroupBlock
              icon={FileJson}
              iconColor="var(--teal)"
              title="Page inventory"
              meta="Set page type hints before generating a single page."
              stats={[{ label: 'Pages', value: generation.availablePages.length }]}
              collapsible
              defaultOpen
            >
              <div className="flex flex-col gap-3 p-2">
                <SearchField
                  value={generation.pageSearch}
                  onChange={generation.setPageSearch}
                  placeholder="Filter pages..."
                />
                <DataTable
                  columns={initialInventoryColumns}
                  rows={initialInventoryRows}
                  getRowKey={(row) => row.id as string}
                  onRowClick={(row) => {
                    toast('Single-page schema generation started', 'info');
                    void generation.generateSinglePage(row.id as string);
                  }}
                />
              </div>
            </GroupBlock>
          )}
        </>
      )}

      {generation.started && pages.length === 0 && !generation.loading && (
        <EmptyState
          icon={EmptyIcon}
          title={generation.singlePageError ? 'Page generation failed' : 'No schema suggestions needed'}
          description={generation.singlePageError || 'The latest scan did not return schema pages for review.'}
          action={<Button size="sm" variant="primary" onClick={handleRunScan}><Icon name="refresh" size="sm" />Re-scan</Button>}
        />
      )}

      {pages.length > 0 && (
        <>
          <div data-testid="schema-generator-hero">
            <SectionCard noPadding className="overflow-hidden">
              <div className="grid min-h-[188px] items-center gap-5 px-[26px] py-[22px] sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-6">
                <div className="mx-auto flex h-[120px] w-[120px] flex-col items-center justify-center rounded-[var(--radius-pill)] border-[9px] border-[var(--surface-3)] bg-[var(--surface-1)] shadow-[var(--shadow-sm)]">
                  <Icon name="file" size="2xl" className="text-[var(--teal)]" />
                  <span className="mt-2 t-micro text-[var(--brand-text-muted)]">Ready for review</span>
                </div>
                <div className="min-w-0">
                  <h2 className="t-h2 max-w-[34ch] font-bold text-[var(--brand-text-bright)]">
                    {readinessTitle}
                  </h2>
                  <p className="mt-2 max-w-[62ch] t-ui leading-[1.55] text-[var(--brand-text)]">
                    {readinessDetail}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={handleRunScan} disabled={generation.loading}>
                      <Icon name="sparkle" size="sm" />
                      Re-generate all
                    </Button>
                    <Button size="sm" variant="secondary" onClick={generation.fetchPages} disabled={generation.loading || generation.loadingPages} loading={generation.loadingPages}>
                      {!generation.loadingPages && <Icon name="plus" size="sm" />}
                      Add a page
                    </Button>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>

          <SchemaWorkflowStrip loading={generation.loading} />

          {generation.loading && (
            <ProgressIndicator
              status="running"
              step="Generating schemas..."
              detail={generation.progressMsg || undefined}
              onCancel={generation.stopScan}
            />
          )}

          {generation.showNextSteps && !generation.loading && (
            <NextStepsCard
              title={`Scan complete: ${formatInteger(pages.length)} pages ready for review`}
              variant="success"
              onDismiss={() => generation.setShowNextSteps(false)}
              steps={[
                {
                  label: 'Review generated pages',
                  onClick: () => {
                    generation.setShowNextSteps(false);
                    document.getElementById('schema-generated-pages')?.scrollIntoView({ behavior: 'smooth' });
                  },
                  estimatedTime: '3 min',
                },
              ]}
            />
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="schema-summary-strip">
            <div className="flex" data-testid="schema-summary-tile">
              <MetricTile label="Generated pages" value={stats.pages} sub="Current schema snapshot" accent="var(--blue)" icon={FileJson} className="min-h-[108px]" />
            </div>
            <div className="flex" data-testid="schema-summary-tile">
              <MetricTile label="@graph types" value={stats.totalGraphTypes} sub="Across generated pages" accent="var(--teal)" icon={FileJson} className="min-h-[108px]" />
            </div>
            <div className="flex" data-testid="schema-summary-tile">
              <MetricTile label="Existing schema" value={stats.pagesWithExisting} sub="Pages already carrying JSON-LD" accent="var(--emerald)" icon={CheckCircle} className="min-h-[108px]" />
            </div>
            <div className="flex" data-testid="schema-summary-tile">
              <MetricTile label="Pages with errors" value={stats.pagesWithErrors} sub={stats.pagesWithWarnings > 0 ? `${formatInteger(stats.pagesWithWarnings)} with warnings` : 'No additional warnings'} accent={stats.pagesWithErrors > 0 ? 'var(--amber)' : 'var(--emerald)'} icon={ShieldCheck} className="min-h-[108px]" />
            </div>
          </div>

          <div data-testid="schema-bulk-band">
            <SectionCard noPadding variant="subtle" className="border-[color-mix(in_srgb,var(--teal)_28%,transparent)] bg-[color-mix(in_srgb,var(--teal)_6%,var(--surface-2))]">
              <div className="flex min-h-[66px] flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-mint-dim)] text-[var(--teal)]">
                  <Icon name="sparkle" size="md" />
                </span>
                <div className="min-w-[220px] flex-1">
                  <div className="t-ui font-semibold text-[var(--brand-text-bright)]">{bulkTitle}</div>
                  <div className="mt-0.5 t-caption text-[var(--brand-text)]">{bulkDetail}{graphValidationQuery.isFetching ? ' Validation is refreshing.' : ''}</div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {!publishing.sentToClient && (
                    <Button size="sm" variant="ghost" onClick={() => setBulkNoteOpen((open) => !open)}>
                      <Icon name="message" size="sm" />
                      {bulkNoteOpen ? 'Hide client note' : 'Add client note'}
                    </Button>
                  )}
                  {publishing.unpublishedCount > 0 && (
                    <Button size="sm" variant="primary" onClick={handlePublishAll} disabled={publishing.bulkPublishing || bulkPublishBlocked} loading={publishing.bulkPublishing}>
                      {!publishing.bulkPublishing && <Icon name="check" size="sm" />}
                      {publishing.bulkPublishing
                        ? `Publishing ${publishing.bulkProgress?.done ?? 0}/${publishing.bulkProgress?.total ?? publishing.unpublishedCount}`
                        : `Publish all (${publishing.unpublishedCount})`}
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => handleSendBatchToClient(bulkSendNote.trim() || undefined)} disabled={publishing.sendingToClient || publishing.sentToClient} loading={publishing.sendingToClient}>
                    {!publishing.sendingToClient && <Icon name="send" size="sm" />}
                    {publishing.sentToClient ? 'Sent to client' : 'Send to client'}
                  </Button>
                </div>
              </div>
              {bulkNoteOpen && !publishing.sentToClient && (
                <div className="border-t border-[var(--brand-border)] px-4 py-3">
                  <FormTextarea
                    value={bulkSendNote}
                    onChange={setBulkSendNote}
                    disabled={publishing.sendingToClient}
                    maxLength={2000}
                    rows={2}
                    placeholder="Add a note for your client (optional)"
                    className="max-w-3xl"
                  />
                </div>
              )}
            </SectionCard>
          </div>

          {publishing.sendToClientError && (
            <InlineBanner
              tone="error"
              size="sm"
              title="Send to client failed"
              onDismiss={() => publishing.setSendToClientError(null)}
              dismissLabel="Dismiss send error"
            >
              {publishing.sendToClientError}
            </InlineBanner>
          )}

          {generation.singlePageError && (
            <InlineBanner
              tone="error"
              title="Page generation failed"
              onDismiss={() => generation.setSinglePageError(null)}
              dismissLabel="Dismiss page generation error"
            >
              {generation.singlePageError}
            </InlineBanner>
          )}

          <SchemaPageTable
            pages={pages}
            pageTypes={generation.pageTypes}
            pageTypeErrors={pageTypeErrors}
            published={publishing.published}
            retractedPages={publishing.retractedPages}
            validationStatusByPageId={validationStatusByPageId}
            onOpenPage={setSelectedPageId}
            onPageTypeChange={handlePageTypeChange}
          />

          <div className="flex flex-col gap-3" data-testid="schema-production-support">
            <SchemaSitePlanBridge siteId={siteId} workspaceId={workspaceId} />
            <SchemaBusinessProfilePanel
              businessProfile={businessProfile}
              localBusinessIntent={localBusinessIntent}
              dismissed={calloutDismissed}
              workspaceId={workspaceId}
              onDismiss={handleDismissCallout}
            />
            <SchemaCmsMappingPanel
              collections={cmsWorkflow.schemaMappingCollections}
              cmsMappingError={cmsWorkflow.cmsMappingError}
              savingCmsMapping={cmsWorkflow.savingCmsMapping}
              fieldMappingTargets={cmsWorkflow.fieldMappingTargets}
              onSaveCmsFieldMapping={cmsWorkflow.saveCmsFieldMapping}
              maxCollections={MAX_SCHEMA_MAPPING_COLLECTIONS}
            />
            {workspaceId && (
              <GroupBlock
                icon={Send}
                iconColor="var(--teal)"
                title="Client approval queue"
                meta="Pending schema reviews and retraction controls."
                collapsible
                defaultOpen={false}
              >
                <div className="p-2">
                  <PendingApprovals
                    workspaceId={workspaceId}
                    refreshKey={publishing.approvalRefreshKey}
                    nameFilter="Schema"
                    onRetracted={() => publishing.setApprovalRefreshKey((key) => key + 1)}
                  />
                </div>
              </GroupBlock>
            )}
            <GroupBlock
              icon={ShieldCheck}
              iconColor="var(--blue)"
              title="Coverage verification"
              meta="Coverage and missing-schema counts require the next trusted crawl."
              collapsible
              defaultOpen={false}
            >
              <div className="p-2"><SchemaInventoryAbsentBanner /></div>
            </GroupBlock>
            <SchemaCompletenessPanel pages={pages} workspaceId={workspaceId} />
            <SchemaImpactPanel data={impactQuery.data} loading={impactQuery.isLoading} />
            <SchemaHowToFooter />
          </div>
        </>
      )}

      <SchemaPagePickerDrawer
        open={generation.showPagePicker}
        pages={generation.availablePages}
        filteredPages={generation.availablePages.filter((page) => (
          !generation.pageSearch
          || page.title.toLowerCase().includes(generation.pageSearch.toLowerCase())
          || page.slug.toLowerCase().includes(generation.pageSearch.toLowerCase())
        ))}
        pageSearch={generation.pageSearch}
        generatingSingle={generation.generatingSingle}
        existingPageIds={existingPageIds}
        onSearchChange={generation.setPageSearch}
        onSelectPage={(pageId) => {
          toast('Single-page schema generation started', 'info');
          void generation.generateSinglePage(pageId);
        }}
        onClose={() => {
          generation.setShowPagePicker(false);
          generation.setPageSearch('');
        }}
      />

      <SchemaPageDrawer
        page={selectedPage}
        siteId={siteId}
        workspaceId={workspaceId}
        editState={selectedPage ? publishing.getState(selectedPage.pageId) : undefined}
        copiedId={publishing.copiedId}
        published={selectedPage ? publishing.published.has(selectedPage.pageId) : false}
        publishing={selectedPage ? publishing.publishing.has(selectedPage.pageId) : false}
        publishError={selectedPage ? publishing.publishError[selectedPage.pageId] : undefined}
        manualDelivery={selectedPage ? publishing.manualDelivery[selectedPage.pageId] : undefined}
        confirmPublish={selectedPage ? publishing.confirmPublish === selectedPage.pageId : false}
        sentPage={selectedPage ? publishing.sentPages.has(selectedPage.pageId) : false}
        sendingPage={selectedPage ? publishing.sendingPage.has(selectedPage.pageId) : false}
        sendPageError={selectedPage ? publishing.sendPageErrors[selectedPage.pageId] : undefined}
        editingSchema={selectedPage ? publishing.editingSchema.has(selectedPage.pageId) : false}
        editedSchemaJson={selectedPage ? publishing.editedSchemaJson[selectedPage.pageId] : undefined}
        schemaParseError={selectedPage ? publishing.schemaParseError[selectedPage.pageId] : undefined}
        showDiff={selectedPage ? publishing.showDiff.has(selectedPage.pageId) : false}
        schemaRecs={selectedPageSchemaRecs}
        pageType={selectedPage ? generation.pageTypes[selectedPage.pageId] || 'auto' : 'auto'}
        savingTemplate={publishing.savingTemplate}
        templateSaved={publishing.templateSaved}
        templateSaveError={publishing.templateSaveError ?? undefined}
        pageTypeError={selectedPage ? pageTypeErrors[selectedPage.pageId] : undefined}
        isRegenLoading={selectedPage ? generation.regenerating.has(selectedPage.pageId) : false}
        validationStatus={selectedPage ? validationStatusForPage(selectedPage, validationStatusByPageId) : undefined}
        retracted={selectedPage ? publishing.retractedPages.has(selectedPage.pageId) : false}
        retracting={selectedPage ? publishing.retractingPages.has(selectedPage.pageId) : false}
        onClose={() => setSelectedPageId(null)}
        onPageTypeChange={handlePageTypeChange}
        onRegenerate={(pageId) => {
          toast('Schema regeneration started', 'info');
          void generation.regeneratePage(pageId);
        }}
        onToggleDiff={publishing.toggleDiff}
        onToggleSchemaEdit={publishing.toggleSchemaEdit}
        onSchemaJsonChange={publishing.handleSchemaJsonChange}
        onCopyTemplate={publishing.copyTemplate}
        onCopyJsonLd={publishing.copyJsonLd}
        onPublish={publishing.publishToWebflow}
        onConfirmPublish={publishing.setConfirmPublish}
        onSendToClient={publishing.sendSingleSchemaToClient}
        onSaveAsTemplate={publishing.saveAsTemplate}
        onRetract={publishing.retractSchema}
        getEffectiveSchema={publishing.getEffectiveSchema}
        onRestore={publishing.restoreSchema}
      />
    </div>
  );
}
