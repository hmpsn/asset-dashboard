// @ds-rebuilt
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, FileJson, Plus, RefreshCw, Send, ShieldCheck, Upload } from 'lucide-react';
import type { BusinessProfileContact } from '../../../shared/types/workspace';
import type { FixContext } from '../../types/fix-context';
import { mutationErrorMessage } from './schemaMutationFeedback';
import { useRecommendations } from '../../hooks/useRecommendations';
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
  Skeleton,
  Toolbar,
  ToolbarSpacer,
  WorkflowStepper,
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
  SchemaQuickStats,
  SchemaSitePlanBridge,
  inferLocalBusinessIntent,
} from './SchemaSupportPanels';
import {
  formatInteger,
  summarizeSchemaPages,
  validationStatusForPage,
} from './schemaFormatters';

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
  const { forPage: recsForPage, loaded: recsLoaded } = useRecommendations(workspaceId);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [pageTypeErrors, setPageTypeErrors] = useState<Record<string, string>>({});
  const [bulkSendNote, setBulkSendNote] = useState('');
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
      <div className="flex flex-col gap-5">
        <WorkflowStepper
          compact
          steps={[
            { number: 1, label: 'Scan', completed: false, current: true },
            { number: 2, label: 'Review', completed: false, current: false },
            { number: 3, label: 'Edit', completed: false, current: false },
            { number: 4, label: 'Publish', completed: false, current: false },
            { number: 5, label: 'Validate', completed: false, current: false },
          ]}
        />
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

  return (
    <div className="flex flex-col gap-5">
      <WorkflowStepper
        compact
        steps={[
          { number: 1, label: 'Scan', completed: pages.length > 0, current: generation.loading },
          { number: 2, label: 'Review', completed: false, current: !generation.loading && pages.length > 0 },
          { number: 3, label: 'Edit', completed: false, current: false },
          { number: 4, label: 'Publish', completed: false, current: false },
          { number: 5, label: 'Validate', completed: false, current: false },
        ]}
      />

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
          action={<Button size="sm" variant="primary" onClick={handleRunScan}><Icon as={RefreshCw} size="sm" />Re-scan</Button>}
        />
      )}

      {pages.length > 0 && (
        <>
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

          <Toolbar label="Schema workflow actions">
            <SchemaQuickStats total={pages.length} unpublished={publishing.unpublishedCount} />
            <ToolbarSpacer />
            <Button size="sm" variant="secondary" onClick={generation.fetchPages} disabled={generation.loading || generation.loadingPages} loading={generation.loadingPages}>
              {!generation.loadingPages && <Icon as={Plus} size="sm" />}
              Add page
            </Button>
            <Button size="sm" variant="secondary" onClick={handleRunScan} disabled={generation.loading}>
              <Icon as={RefreshCw} size="sm" />
              Re-generate all
            </Button>
            {publishing.unpublishedCount > 0 && (
              <Button size="sm" variant="primary" onClick={handlePublishAll} disabled={publishing.bulkPublishing || bulkPublishBlocked} loading={publishing.bulkPublishing}>
                {!publishing.bulkPublishing && <Icon as={Upload} size="sm" />}
                {publishing.bulkPublishing
                  ? `Publishing ${publishing.bulkProgress?.done ?? 0}/${publishing.bulkProgress?.total ?? publishing.unpublishedCount}`
                  : `Publish all (${publishing.unpublishedCount})`}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => handleSendBatchToClient(bulkSendNote.trim() || undefined)} disabled={publishing.sendingToClient || publishing.sentToClient} loading={publishing.sendingToClient}>
              {!publishing.sendingToClient && <Icon as={Send} size="sm" />}
              {publishing.sentToClient ? 'Sent to client' : 'Send to client'}
            </Button>
          </Toolbar>

          {!publishing.sentToClient && (
            <FormTextarea
              value={bulkSendNote}
              onChange={setBulkSendNote}
              disabled={publishing.sendingToClient}
              maxLength={2000}
              rows={2}
              placeholder="Add a note for your client (optional)"
              className="max-w-3xl"
            />
          )}

          {graphValidation && (
            <InlineBanner
              tone={graphValidation.status === 'errors' ? 'error' : graphValidation.status === 'warnings' ? 'warning' : 'success'}
              title={`Site graph ${graphValidation.status}`}
            >
              {graphValidation.status === 'errors'
                ? `${graphValidation.findings.filter((finding) => finding.severity === 'error').length} graph errors must be fixed before bulk publish.`
                : graphValidation.status === 'warnings'
                  ? `${graphValidation.findings.filter((finding) => finding.severity === 'warning').length} warnings found. Individual and bulk publish remain available.`
                  : `${graphValidation.nodeCount} nodes and ${graphValidation.referenceCount} references checked.`}
              {graphValidationQuery.isFetching ? ' Refreshing validation.' : ''}
            </InlineBanner>
          )}

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

          {workspaceId && (
            <PendingApprovals
              workspaceId={workspaceId}
              refreshKey={publishing.approvalRefreshKey}
              nameFilter="Schema"
              onRetracted={() => publishing.setApprovalRefreshKey((key) => key + 1)}
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricTile label="Pages" value={stats.pages} sub={`${formatInteger(stats.totalGraphTypes)} generated @graph types`} accent="var(--blue)" icon={FileJson} />
            <MetricTile label="Validated" value={`${stats.pages - stats.pagesWithErrors}/${stats.pages}`} sub={stats.pagesWithErrors > 0 ? `${stats.pagesWithErrors} with errors` : stats.pagesWithWarnings > 0 ? `${stats.pagesWithWarnings} warnings` : 'No blocking errors'} accent={stats.pagesWithErrors > 0 ? 'var(--amber)' : 'var(--emerald)'} icon={ShieldCheck} />
            <MetricTile label="Existing schema" value={stats.pagesWithExisting} sub="Pages already carrying JSON-LD" accent="var(--emerald)" icon={CheckCircle} />
            <MetricTile label="Rich eligible" value={stats.richEligible} sub="Eligible rich-result features" accent="var(--teal)" icon={FileJson} />
            <MetricTile label="Coverage" value="—" sub="Awaiting server projection" accent="var(--blue)" icon={ShieldCheck} />
          </div>

          <SchemaInventoryAbsentBanner />

          <SchemaPageTable
            pages={pages}
            pageTypes={generation.pageTypes}
            pageTypeErrors={pageTypeErrors}
            regenerating={generation.regenerating}
            published={publishing.published}
            retractedPages={publishing.retractedPages}
            validationStatusByPageId={validationStatusByPageId}
            onOpenPage={setSelectedPageId}
            onRegenerate={(pageId) => {
              toast('Schema regeneration started', 'info');
              void generation.regeneratePage(pageId);
            }}
            onPageTypeChange={handlePageTypeChange}
          />

          <SchemaCompletenessPanel pages={pages} workspaceId={workspaceId} />
          <SchemaImpactPanel data={impactQuery.data} loading={impactQuery.isLoading} />
          <SchemaHowToFooter />
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
        schemaRecs={selectedPage && recsLoaded ? recsForPage(selectedPage.url || selectedPage.slug).filter((rec) => rec.type === 'schema') : []}
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
