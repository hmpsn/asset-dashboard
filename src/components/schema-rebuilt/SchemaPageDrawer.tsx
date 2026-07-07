// @ds-rebuilt
import { useState } from 'react';
import { CheckCircle, Clock, Copy, GitCompareArrows, History, Pencil, RefreshCw, Save, Send, ShieldCheck, Trash2, Upload } from 'lucide-react';
import type { SchemaDeliveryDecision } from '../../../shared/types/schema-generation';
import type { SchemaPageSuggestion, SchemaSuggestion } from '../schema/schemaSuggesterTypes';
import type { SchemaPageCardRecommendation } from '../schema/SchemaPageCardDetails';
import type { PageEditStatus } from '../ui/statusConfig';
import { SCHEMA_PAGE_TYPE_OPTIONS } from '../schema/schemaPageTypeOptions';
import {
  ExistingSchemasSection,
  GenerationDiagnosticsSection,
  GraphTypesSection,
  RecommendationBanners,
  RichResultsEligibilitySection,
  ValidationFindingsSection,
} from '../schema/SchemaPageCardDetails';
import { SchemaEditor } from '../schema/SchemaEditor';
import { SchemaVersionHistory } from '../schema/SchemaVersionHistory';
import {
  Badge,
  Button,
  Drawer,
  FormSelect,
  FormTextarea,
  Icon,
  InlineBanner,
  StatusBadge,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import {
  graphTypesForPage,
  isCmsPage,
  isHomepage,
  pathForPage,
  schemaPreview,
  staleDaysForPage,
  titleForPage,
  validationLabel,
  validationTone,
} from './schemaFormatters';

export interface SchemaPageDrawerProps {
  page: SchemaPageSuggestion | null;
  siteId: string;
  workspaceId: string;
  editState: { status: PageEditStatus | null | undefined } | undefined;
  copiedId: string | null;
  published: boolean;
  publishing: boolean;
  publishError?: string;
  manualDelivery?: SchemaDeliveryDecision;
  confirmPublish: boolean;
  sentPage: boolean;
  sendingPage: boolean;
  sendPageError?: string;
  editingSchema: boolean;
  editedSchemaJson?: string;
  schemaParseError?: string;
  showDiff: boolean;
  schemaRecs: SchemaPageCardRecommendation[];
  pageType: string;
  savingTemplate: boolean;
  templateSaved: boolean;
  templateSaveError?: string;
  pageTypeError?: string;
  isRegenLoading: boolean;
  validationStatus?: 'valid' | 'warnings' | 'errors';
  retracted: boolean;
  retracting: boolean;
  onClose: () => void;
  onPageTypeChange: (pageId: string, type: string) => void;
  onRegenerate: (pageId: string) => void;
  onToggleDiff: (pageId: string) => void;
  onToggleSchemaEdit: (pageId: string, template: Record<string, unknown>) => void;
  onSchemaJsonChange: (pageId: string, value: string) => void;
  onCopyTemplate: (suggestion: SchemaSuggestion, pageId: string) => void;
  onCopyJsonLd: (suggestion: SchemaSuggestion, pageId: string) => void;
  onPublish: (pageId: string, schema: Record<string, unknown>) => void;
  onConfirmPublish: (pageId: string | null) => void;
  onSendToClient: (page: SchemaPageSuggestion, note?: string) => void;
  onSaveAsTemplate: (pageId: string) => void;
  onRetract: (pageId: string) => void;
  getEffectiveSchema: (pageId: string, original: Record<string, unknown>) => Record<string, unknown>;
  onRestore: (pageId: string, schema: Record<string, unknown>) => void;
}

function CopyButton({
  copied,
  children,
  onClick,
}: {
  copied: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant="secondary" onClick={onClick}>
      <Icon as={copied ? CheckCircle : Copy} size="sm" />
      {copied ? 'Copied' : children}
    </Button>
  );
}

export function SchemaPageDrawer({
  page,
  siteId,
  workspaceId,
  editState,
  copiedId,
  published,
  publishing,
  publishError,
  manualDelivery,
  confirmPublish,
  sentPage,
  sendingPage,
  sendPageError,
  editingSchema,
  editedSchemaJson,
  schemaParseError,
  showDiff,
  schemaRecs,
  pageType,
  savingTemplate,
  templateSaved,
  templateSaveError,
  pageTypeError,
  isRegenLoading,
  validationStatus,
  retracted,
  retracting,
  onClose,
  onPageTypeChange,
  onRegenerate,
  onToggleDiff,
  onToggleSchemaEdit,
  onSchemaJsonChange,
  onCopyTemplate,
  onCopyJsonLd,
  onPublish,
  onConfirmPublish,
  onSendToClient,
  onSaveAsTemplate,
  onRetract,
  getEffectiveSchema,
  onRestore,
}: SchemaPageDrawerProps) {
  const [note, setNote] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  if (!page) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const schema = page.suggestedSchemas[0];
  const graphTypes = graphTypesForPage(page);
  const staleDays = staleDaysForPage(page);
  const cmsPage = isCmsPage(page);
  const homepage = isHomepage(page);
  const effectiveSchema = schema ? getEffectiveSchema(page.pageId, schema.template) : {};
  const cmsStatus = page.cmsDeliveryStatus?.status;
  const cmsUnavailable = cmsPage && cmsStatus !== 'ready' && cmsStatus !== 'written' && cmsStatus !== 'unchanged';
  const confirmLabel = cmsPage
    ? `Write schema to CMS field${editedSchemaJson ? ' (edited)' : ''}?`
    : `Publish ${editedSchemaJson ? 'edited ' : ''}schema to this page's head?`;
  const publishLabel = cmsPage ? 'Publish to CMS field' : 'Publish to Webflow';

  return (
    <Drawer
      open
      onClose={onClose}
      title={titleForPage(page)}
      eyebrow="Schema page detail"
      subtitle={pathForPage(page)}
      width="min(920px, 94vw)"
      footer={(
        <Toolbar label="Schema page drawer actions" className="w-full border-none bg-transparent p-0">
          <Button size="sm" variant="secondary" onClick={() => onRegenerate(page.pageId)} loading={isRegenLoading}>
            {!isRegenLoading && <Icon as={RefreshCw} size="sm" />}
            Regenerate
          </Button>
          <ToolbarSpacer />
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
        </Toolbar>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={editState?.status} />
          <Badge label={validationLabel(validationStatus)} tone={validationTone(validationStatus)} variant="outline" size="sm" icon={validationStatus === 'valid' ? ShieldCheck : Clock} />
          {page.existingSchemas.length > 0 && <Badge label={`${page.existingSchemas.length} existing`} tone="emerald" variant="outline" size="sm" />}
          {graphTypes.length > 0 && <Badge label={`${graphTypes.length} graph types`} tone="teal" variant="outline" size="sm" />}
          {staleDays !== null && <Badge label={`${staleDays}d old`} tone="amber" variant="outline" size="sm" icon={Clock} />}
          {sentPage && <Badge label="Sent to client" tone="blue" variant="outline" size="sm" icon={Send} />}
          {retracted && <Badge label="Retracted" tone="zinc" variant="outline" size="sm" icon={Trash2} />}
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)]">
            <ExistingSchemasSection schemas={page.existingSchemas} />
            <ValidationFindingsSection findings={page.validationFindings} validationErrors={page.validationErrors} />
            <RecommendationBanners recommendations={schemaRecs} />
            <GraphTypesSection graphTypes={graphTypes} reason={schema?.reason ?? 'No generated schema is available for this page yet.'} />
            <GenerationDiagnosticsSection diagnostics={page.generationDiagnostics} />
            <RichResultsEligibilitySection eligibility={page.richResultsEligibility} />
          </div>

          <div className="flex flex-col gap-3">
            <label className="block">
              <span className="t-caption-sm text-[var(--brand-text-muted)]">Page type hint</span>
              <FormSelect
                value={pageType}
                onChange={(value) => onPageTypeChange(page.pageId, value)}
                options={SCHEMA_PAGE_TYPE_OPTIONS}
                className="mt-1 w-full"
              />
            </label>
            {pageTypeError && (
              <InlineBanner tone="warning" size="sm" title="Page type not saved">
                {pageTypeError}
              </InlineBanner>
            )}
            {cmsUnavailable && (
              <InlineBanner tone="warning" size="sm" title="CMS publish unavailable">
                {page.cmsDeliveryStatus?.message || 'Map a schema field before publishing this CMS item.'}
              </InlineBanner>
            )}
            {staleDays !== null && (
              <InlineBanner tone="warning" size="sm" title="Published schema is stale">
                Regenerate this page before republishing if content changed after the last deployment.
              </InlineBanner>
            )}
          </div>
        </div>

        {schema ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--brand-border)] px-4 py-3">
              <div>
                <div className="t-ui font-semibold text-[var(--brand-text-bright)]">JSON-LD workspace</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Review generated markup, compare existing JSON-LD, or edit the effective schema.</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {page.existingSchemaJson && page.existingSchemaJson.length > 0 && (
                  <Button size="sm" variant={showDiff ? 'primary' : 'secondary'} onClick={() => onToggleDiff(page.pageId)}>
                    <Icon as={GitCompareArrows} size="sm" />
                    {showDiff ? 'Hide diff' : 'Show diff'}
                  </Button>
                )}
                <Button size="sm" variant={editingSchema ? 'primary' : 'secondary'} onClick={() => onToggleSchemaEdit(page.pageId, schema.template)}>
                  <Icon as={Pencil} size="sm" />
                  {editingSchema ? 'Done editing' : 'Edit'}
                </Button>
                <CopyButton
                  copied={copiedId === `${page.pageId}-${schema.type}`}
                  onClick={() => onCopyTemplate(schema, page.pageId)}
                >
                  Copy script
                </CopyButton>
                <CopyButton
                  copied={copiedId === `${page.pageId}-${schema.type}-json`}
                  onClick={() => onCopyJsonLd(schema, page.pageId)}
                >
                  Copy JSON-LD
                </CopyButton>
              </div>
            </div>

            <div className="p-4">
              {showDiff && page.existingSchemaJson ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  <div>
                    <div className="mb-1.5 t-caption-sm font-semibold" style={{ color: 'var(--red)' }}>Current on page</div>
                    <pre className="max-h-80 overflow-auto rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3 t-mono text-[var(--brand-text-muted)]">
                      {schemaPreview(page.existingSchemaJson.length === 1 ? page.existingSchemaJson[0] : { '@graph': page.existingSchemaJson })}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1.5 t-caption-sm font-semibold" style={{ color: 'var(--emerald)' }}>Suggested effective schema</div>
                    <pre className="max-h-80 overflow-auto rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3 t-mono text-[var(--brand-text-muted)]">
                      {schemaPreview(effectiveSchema)}
                    </pre>
                  </div>
                </div>
              ) : editingSchema ? (
                <SchemaEditor
                  pageId={page.pageId}
                  schemaJson={editedSchemaJson || schemaPreview(schema.template)}
                  parseError={schemaParseError}
                  hasEdits={!!editedSchemaJson}
                  onChange={onSchemaJsonChange}
                />
              ) : (
                <pre className="max-h-96 overflow-auto rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3 t-mono text-[var(--brand-text-muted)]">
                  {schemaPreview(effectiveSchema)}
                </pre>
              )}
            </div>
          </div>
        ) : (
          <InlineBanner tone="info" title="No generated schema yet">
            Regenerate this page to create JSON-LD before publishing or sending it to the client.
          </InlineBanner>
        )}

        {manualDelivery?.status === 'manual-required' && (
          <InlineBanner tone="warning" title="Manual Webflow schema paste required">
            <div className="flex flex-col gap-2">
              <span>{manualDelivery.message}</span>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">
                Target: Webflow Page Settings -&gt; Schema markup
                {manualDelivery.characterCount && manualDelivery.apiLimit ? ` · API payload ${manualDelivery.characterCount}/${manualDelivery.apiLimit} chars` : ''}
              </span>
              {schema && (
                <Button size="sm" variant="secondary" onClick={() => onCopyJsonLd(schema, page.pageId)}>
                  <Icon as={Copy} size="sm" />
                  Copy JSON-LD
                </Button>
              )}
            </div>
          </InlineBanner>
        )}

        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="t-ui font-semibold text-[var(--brand-text-bright)]">Publish and send</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)]">Validate the graph gate, publish through existing services, or send the effective schema to the client.</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {published ? (
                <Badge label={cmsPage ? 'Published to CMS field' : 'Published to Webflow'} tone="emerald" variant="outline" size="sm" icon={CheckCircle} />
              ) : confirmPublish ? (
                <>
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">{confirmLabel}</span>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onPublish(page.pageId, effectiveSchema)}
                    disabled={publishing || !!schemaParseError || validationStatus === 'errors' || cmsUnavailable}
                    loading={publishing}
                  >
                    {!publishing && <Icon as={Upload} size="sm" />}
                    Yes, publish
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => onConfirmPublish(null)}>Cancel</Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => onConfirmPublish(page.pageId)}
                  disabled={publishing || !schema || cmsUnavailable}
                  loading={publishing}
                >
                  {!publishing && <Icon as={Upload} size="sm" />}
                  {publishLabel}
                </Button>
              )}

              {homepage && (
                templateSaved ? (
                  <Badge label="Template saved" tone="emerald" variant="outline" size="sm" icon={CheckCircle} />
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => onSaveAsTemplate(page.pageId)} loading={savingTemplate} disabled={!schema}>
                    {!savingTemplate && <Icon as={Save} size="sm" />}
                    Save as site template
                  </Button>
                )
              )}

              {published && !retracted && !cmsPage && (
                <Button size="sm" variant="danger" onClick={() => onRetract(page.pageId)} loading={retracting}>
                  {!retracting && <Icon as={Trash2} size="sm" />}
                  Retract
                </Button>
              )}
            </div>
          </div>

          {publishError && <InlineBanner tone="error" size="sm" title="Publish failed">{publishError}</InlineBanner>}
          {templateSaveError && <InlineBanner tone="warning" size="sm" title="Template was not saved">{templateSaveError}</InlineBanner>}
          {cmsPage && published && !retracted && (
            <InlineBanner tone="info" size="sm" title="CMS retract restriction">
              Clear the mapped schema field in Webflow CMS to remove schema from this item.
            </InlineBanner>
          )}

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <FormTextarea
              value={note}
              onChange={setNote}
              disabled={sendingPage || sentPage}
              maxLength={2000}
              rows={3}
              placeholder="Add a note for your client (optional)"
              className="w-full"
            />
            <div className="flex flex-col gap-2">
              {sentPage ? (
                <Badge label="Sent to client" tone="blue" variant="outline" size="sm" icon={CheckCircle} />
              ) : (
                <Button size="sm" variant="secondary" onClick={() => onSendToClient(page, note.trim() || undefined)} loading={sendingPage} disabled={!schema}>
                  {!sendingPage && <Icon as={Send} size="sm" />}
                  Send to client
                </Button>
              )}
              {sendPageError && <InlineBanner tone="error" size="sm" title="Send failed">{sendPageError}</InlineBanner>}
            </div>
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowHistory((value) => !value)}
            className="w-full justify-start rounded-[var(--radius-lg)] px-4 py-3"
          >
            <Icon as={History} size="sm" />
            Version history and rollback
          </Button>
          {showHistory && (
            <div className="border-t border-[var(--brand-border)] p-4">
              <SchemaVersionHistory
                siteId={siteId}
                pageId={page.pageId}
                workspaceId={workspaceId}
                onRestore={(restoredSchema) => onRestore(page.pageId, restoredSchema)}
              />
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
