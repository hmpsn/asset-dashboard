/**
 * SchemaPageCard — Per-page card rendering for schema suggestions.
 * Extracted from SchemaSuggester.tsx per-page rendering logic.
 */
import { useState } from 'react';
import {
  ChevronDown, ChevronRight, Copy, CheckCircle,
  AlertCircle, Sparkles, RefreshCw, Upload, Send,
  ArrowRight, GitCompareArrows, Pencil, AlertTriangle,
  Loader2, Save, Trash2, Star, History, Clock, ShieldCheck, XCircle,
} from 'lucide-react';
import { Badge, StatusBadge, FormSelect, FormTextarea, Icon, Button, IconButton, ClickableRow, cn } from '../ui';
import { statusBorderClass, type PageEditStatus } from '../ui/statusConfig';
import { SchemaEditor } from './SchemaEditor';
import { SchemaVersionHistory } from './SchemaVersionHistory';
import type { SchemaDeliveryDecision } from '../../../shared/types/schema-generation';
import type { SchemaPageSuggestion, SchemaSuggestion } from './schemaSuggesterTypes';
import {
  ExistingSchemasSection,
  GenerationDiagnosticsSection,
  GraphTypesSection,
  RecommendationBanners,
  RichResultsEligibilitySection,
  ValidationFindingsSection,
  type SchemaPageCardRecommendation,
} from './SchemaPageCardDetails';

export interface SchemaPageCardProps {
  page: SchemaPageSuggestion;
  isOpen: boolean;
  isRegenLoading: boolean;
  editState: { status: PageEditStatus | null | undefined } | undefined;
  copiedId: string | null;
  published: boolean;
  publishing: boolean;
  publishError: string | undefined;
  manualDelivery: SchemaDeliveryDecision | undefined;
  confirmPublish: boolean;
  sentPage: boolean;
  sendingPage: boolean;
  editingSchema: boolean;
  editedSchemaJson: string | undefined;
  schemaParseError: string | undefined;
  showDiff: boolean;
  schemaRecs: SchemaPageCardRecommendation[];
  workspaceId?: string;
  pageType: string;
  isHomepage: boolean;
  savingTemplate: boolean;
  templateSaved: boolean;
  onPageTypeChange: (pageId: string, type: string) => void;
  // Callbacks
  onToggleExpand: (pageId: string) => void;
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
  retracting: boolean;
  retracted: boolean;
  getEffectiveSchema: (pageId: string, original: Record<string, unknown>) => Record<string, unknown>;
  siteId: string;
  onRestore: (pageId: string, schema: Record<string, unknown>) => void;
  validationStatus?: 'valid' | 'warnings' | 'errors';
}

export function SchemaPageCard({
  page, isOpen, isRegenLoading, editState, copiedId,
  published, publishing, publishError, manualDelivery, confirmPublish,
  sentPage, sendingPage, editingSchema, editedSchemaJson,
  schemaParseError, showDiff, schemaRecs, workspaceId,
  pageType, isHomepage, savingTemplate, templateSaved,
  onPageTypeChange,
  onToggleExpand, onRegenerate, onToggleDiff, onToggleSchemaEdit,
  onSchemaJsonChange, onCopyTemplate, onCopyJsonLd, onPublish, onConfirmPublish,
  onSendToClient, onSaveAsTemplate, onRetract, retracting, retracted,
  getEffectiveSchema, siteId, onRestore, validationStatus,
}: SchemaPageCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [pageNote, setPageNote] = useState('');
  const hasErrors = (page.validationErrors?.length || 0) > 0;
  const schema = page.suggestedSchemas[0];
  const graphTypes = schema ? ((schema.template?.['@graph'] as Record<string, unknown>[]) || []).map(n => n['@type'] as string).filter(Boolean) : [];
  const eligibleCount = page.richResultsEligibility?.filter(r => r.eligible).length || 0;
  const diagnostics = page.generationDiagnostics;

  // Stale schema detection: published > 90 days ago
  const staleDays = page.lastPublishedAt
    ? Math.floor((Date.now() - new Date(page.lastPublishedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isStale = staleDays !== null && staleDays > 90;

  return (
    <div
      className={cn('bg-[var(--surface-2)] border overflow-hidden', statusBorderClass(editState?.status) || (hasErrors ? 'border-amber-500/30' : 'border-[var(--brand-border)]'))}
      style={{ borderRadius: '10px 24px 10px 24px' }} // asymmetric-radius-ok
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <ClickableRow
          onClick={() => onToggleExpand(page.pageId)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity bg-transparent"
        >
          {isOpen ? <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" /> : <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="t-body font-medium text-[var(--brand-text-bright)] truncate">{page.pageTitle}</div>
            <div className="t-caption text-[var(--brand-text-muted)] truncate">/{page.slug}</div>
          </div>
        </ClickableRow>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={editState?.status} />
          {page.existingSchemas.length > 0 && (
            <Badge label={`${page.existingSchemas.length} existing`} tone="emerald" variant="outline" shape="pill" size="sm" icon={CheckCircle} />
          )}
          {graphTypes.length > 0 && (
            <Badge label={`${graphTypes.length} types`} tone="teal" variant="outline" shape="pill" size="sm" icon={Sparkles} />
          )}
          {eligibleCount > 0 && (
            <Badge label={`${eligibleCount} rich`} tone="emerald" variant="outline" shape="pill" size="sm" icon={Star} className="cursor-help" ariaLabel={`${eligibleCount} rich result type${eligibleCount > 1 ? 's' : ''} eligible`} />
          )}
          {isStale && (
            <Badge label={`${staleDays}d old`} tone="amber" variant="outline" shape="pill" size="sm" icon={Clock} className="cursor-help" ariaLabel={`Published ${staleDays} days ago - consider refreshing`} />
          )}
          {hasErrors && (
            <Badge label={`${page.validationErrors!.length}`} tone="amber" variant="outline" shape="pill" size="sm" icon={AlertCircle} />
          )}
          {schemaRecs.length > 0 && (
            <Badge label={`${schemaRecs.length} rec${schemaRecs.length > 1 ? 's' : ''}`} tone="amber" variant="outline" shape="pill" size="sm" icon={AlertTriangle} />
          )}
          <FormSelect
            value={pageType}
            onChange={value => onPageTypeChange(page.pageId, value)}
            onClick={e => e.stopPropagation()}
            options={[
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
              { value: 'author', label: 'Author Profile' },
              { value: 'howto', label: 'How-To / Tutorial' },
              { value: 'video', label: 'Video Page' },
              { value: 'job-posting', label: 'Job Posting' },
              { value: 'course', label: 'Course / Training' },
              { value: 'event', label: 'Event' },
              { value: 'review', label: 'Review' },
              { value: 'pricing', label: 'Pricing Page' },
              { value: 'recipe', label: 'Recipe' },
              { value: 'generic', label: 'General Page' },
            ]}
            className="px-1.5 py-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] t-caption-sm text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 cursor-pointer"
            title="Page type hint for schema generation"
          />
          <IconButton
            onClick={(e) => { e.stopPropagation(); onRegenerate(page.pageId); }}
            disabled={isRegenLoading}
            icon={isRegenLoading ? Loader2 : RefreshCw}
            label="Regenerate schema for this page"
            size="sm"
            variant="solid"
            className={cn(
              'rounded-[var(--radius-md)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)]',
              isRegenLoading && 'animate-pulse',
            )}
            title="Regenerate schema for this page"
          />
        </div>
      </div>

      {isOpen && schema && (
        <div className="border-t border-[var(--brand-border)]">
          <ExistingSchemasSection schemas={page.existingSchemas} />
          <ValidationFindingsSection findings={page.validationFindings} validationErrors={page.validationErrors} />
          <RecommendationBanners recommendations={schemaRecs} />
          <GraphTypesSection graphTypes={graphTypes} reason={schema.reason} />
          <GenerationDiagnosticsSection diagnostics={diagnostics} />
          <RichResultsEligibilitySection eligibility={page.richResultsEligibility} />

          {/* Schema preview / diff / editor */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {page.existingSchemaJson && page.existingSchemaJson.length > 0 && (
                  <Button
                    onClick={() => onToggleDiff(page.pageId)}
                    icon={GitCompareArrows}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'rounded-[var(--radius-md)] font-medium',
                      showDiff
                        ? 'bg-[var(--surface-3)] text-[var(--brand-text-bright)] border border-[var(--brand-border-hover)]'
                        : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)]'
                    )}
                  >
                    {showDiff ? 'Hide Diff' : 'Show Diff'}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  onClick={() => onToggleSchemaEdit(page.pageId, schema.template)}
                  icon={Pencil}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'rounded-[var(--radius-md)] font-medium',
                    editingSchema
                      ? 'bg-teal-500/15 text-teal-400 border border-teal-500/30'
                      : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)]'
                  )}
                >
                  {editingSchema ? 'Done Editing' : 'Edit'}
                </Button>
                <Button
                  onClick={() => onCopyTemplate(schema, page.pageId)}
                  icon={copiedId === `${page.pageId}-${schema.type}` ? CheckCircle : Copy}
                  variant="ghost"
                  size="sm"
                  className="rounded-[var(--radius-md)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
                >
                  {copiedId === `${page.pageId}-${schema.type}` ? (
                    'Copied'
                  ) : (
                    'Copy script'
                  )}
                </Button>
                <Button
                  onClick={() => onCopyJsonLd(schema, page.pageId)}
                  icon={copiedId === `${page.pageId}-${schema.type}-json` ? CheckCircle : Copy}
                  variant="ghost"
                  size="sm"
                  className="rounded-[var(--radius-md)] bg-teal-500/10 hover:bg-teal-500/15 text-teal-300 border border-teal-500/25"
                  title="Copy JSON only for Webflow Page Settings -> Schema markup"
                >
                  {copiedId === `${page.pageId}-${schema.type}-json` ? (
                    'JSON copied'
                  ) : (
                    'Copy JSON-LD'
                  )}
                </Button>
              </div>
            </div>

            {showDiff && page.existingSchemaJson ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="t-caption-sm font-medium text-red-400/80 mb-1 flex items-center gap-1">
                    <span className="badge-span-ok w-2 h-2 rounded-[var(--radius-pill)] bg-red-400/60" /> Current (on page)
                  </div>
                  <pre className="t-caption font-mono bg-[var(--surface-1)] rounded-[var(--radius-md)] p-3 overflow-x-auto text-[var(--brand-text-muted)] border border-red-500/20 max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {JSON.stringify(page.existingSchemaJson.length === 1 ? page.existingSchemaJson[0] : page.existingSchemaJson, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="t-caption-sm font-medium text-emerald-400/80 mb-1 flex items-center gap-1">
                    <span className="badge-span-ok w-2 h-2 rounded-[var(--radius-pill)] bg-emerald-400/60" /> Suggested <Icon as={ArrowRight} size="sm" />
                  </div>
                  <pre className="t-caption font-mono bg-[var(--surface-1)] rounded-[var(--radius-md)] p-3 overflow-x-auto text-[var(--brand-text-muted)] border border-emerald-500/20 max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {JSON.stringify(schema.template, null, 2)}
                  </pre>
                </div>
              </div>
            ) : editingSchema ? (
              <SchemaEditor
                pageId={page.pageId}
                schemaJson={editedSchemaJson || JSON.stringify(schema.template, null, 2)}
                parseError={schemaParseError}
                hasEdits={!!editedSchemaJson}
                onChange={onSchemaJsonChange}
              />
            ) : (
              <pre className="t-caption font-mono bg-[var(--surface-1)] rounded-[var(--radius-md)] p-3 overflow-x-auto text-[var(--brand-text-muted)] border border-[var(--brand-border)] max-h-64 overflow-y-auto">
                {JSON.stringify(getEffectiveSchema(page.pageId, schema.template), null, 2)}
              </pre>
            )}

            {/* Publish to Webflow */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {/* Validation status badge */}
              {validationStatus === 'valid' && (
                <Badge label="Schema valid" tone="emerald" variant="outline" shape="pill" size="sm" icon={ShieldCheck} />
              )}
              {validationStatus === 'warnings' && (
                <Badge label="Warnings" tone="amber" variant="outline" shape="pill" size="sm" icon={AlertTriangle} />
              )}
              {validationStatus === 'errors' && (
                <Badge label="Fix errors to publish" tone="red" variant="outline" shape="pill" size="sm" icon={XCircle} ariaLabel="Fix errors before publishing" />
              )}
              {!page.pageId.startsWith('cms-') && (
                published ? (
                  <Badge label="Published to Webflow" tone="emerald" variant="outline" shape="sm" size="md" icon={CheckCircle} />
                ) : confirmPublish ? (
                  <div className="flex items-center gap-2">
                    <span className="t-caption text-amber-400/80">Publish {editedSchemaJson ? 'edited ' : ''}schema to this page&apos;s &lt;head&gt;?</span>
                    <Button
                      onClick={() => onPublish(page.pageId, getEffectiveSchema(page.pageId, schema.template))}
                      disabled={publishing || !!schemaParseError || validationStatus === 'errors'}
                      loading={publishing}
                      icon={publishing ? undefined : Upload}
                      variant="primary"
                      size="sm"
                      className="rounded-[var(--radius-md)] bg-emerald-600 hover:bg-emerald-500 text-white"
                    >
                      Yes, publish
                    </Button>
                    <Button
                      onClick={() => onConfirmPublish(null)}
                      variant="secondary"
                      size="sm"
                      className="rounded-[var(--radius-md)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)]"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    // pr-check-disable-next-line -- publish action with loading state
                    onClick={() => onConfirmPublish(page.pageId)}
                    disabled={publishing}
                    loading={publishing}
                    icon={publishing ? undefined : Upload}
                    variant="primary"
                    size="sm"
                    className="rounded-[var(--radius-md)] bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white"
                  >
                    {publishing ? (
                      'Publishing...'
                    ) : (
                      'Publish to Webflow'
                    )}
                  </Button>
                )
              )}
              {isHomepage && (
                templateSaved ? (
                  <Badge label="Template Saved" tone="emerald" variant="outline" shape="sm" size="md" icon={CheckCircle} />
                ) : (
                  <Button
                    onClick={() => onSaveAsTemplate(page.pageId)}
                    disabled={savingTemplate}
                    loading={savingTemplate}
                    icon={savingTemplate ? undefined : Save}
                    variant="ghost"
                    size="sm"
                    className="rounded-[var(--radius-md)] bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/30"
                    title="Save Organization + WebSite nodes as the site-wide template for subpages"
                  >
                    {savingTemplate ? (
                      'Saving...'
                    ) : (
                      'Save as Site Template'
                    )}
                  </Button>
                )
              )}
              {published && !retracted && (
                <Button
                  onClick={() => onRetract(page.pageId)}
                  disabled={retracting}
                  loading={retracting}
                  icon={retracting ? undefined : Trash2}
                  variant="ghost"
                  size="sm"
                  className="rounded-[var(--radius-md)] bg-red-500/8 hover:bg-red-500/15 text-red-400/80 border border-red-500/30"
                >
                  Retract
                </Button>
              )}
              {retracted && (
                <Badge label="Retracted" tone="zinc" variant="outline" shape="sm" size="md" icon={Trash2} />
              )}
              {publishError && (
                <span className="badge-span-ok t-caption text-red-400/80">{publishError}</span>
              )}
              {manualDelivery?.status === 'manual-required' && (
                <div className="basis-full rounded-[var(--radius-md)] border border-amber-500/25 bg-amber-500/8 p-3 text-amber-100/90">
                  <div className="flex items-start gap-2">
                    <Icon as={AlertTriangle} size="md" className="mt-0.5 text-amber-400/80" />
                    <div className="min-w-0 space-y-2">
                      <div>
                        <div className="t-caption font-semibold text-amber-300">Manual Webflow schema paste required</div>
                        <p className="t-caption text-amber-100/75">{manualDelivery.message}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="t-caption-sm text-amber-100/70">
                          Target: Webflow Page Settings -&gt; Schema markup
                          {manualDelivery.characterCount && manualDelivery.apiLimit
                            ? ` · API payload ${manualDelivery.characterCount}/${manualDelivery.apiLimit} chars`
                            : ''}
                        </span>
                        <Button
                          onClick={() => onCopyJsonLd(schema, page.pageId)}
                          icon={copiedId === `${page.pageId}-${schema.type}-json` ? CheckCircle : Copy}
                          variant="ghost"
                          size="sm"
                          className="rounded-[var(--radius-md)] bg-amber-500/12 hover:bg-amber-500/18 text-amber-200 border border-amber-500/25"
                        >
                          {copiedId === `${page.pageId}-${schema.type}-json` ? (
                            'JSON copied'
                          ) : (
                            'Copy JSON-LD'
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {workspaceId && (
                sentPage ? (
                  <Badge label="Sent to client" tone="blue" variant="outline" shape="sm" size="md" icon={CheckCircle} />
                ) : (
                  <>
                    <Button
                      onClick={() => onSendToClient(page, pageNote.trim() || undefined)}
                      disabled={sendingPage}
                      loading={sendingPage}
                      icon={sendingPage ? undefined : Send}
                      variant="ghost"
                      size="sm"
                      className="rounded-[var(--radius-md)] bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/30"
                    >
                      {sendingPage ? (
                        'Sending...'
                      ) : (
                        'Send to client'
                      )}
                    </Button>
                    <FormTextarea
                      value={pageNote}
                      onChange={setPageNote}
                      disabled={sendingPage}
                      maxLength={2000}
                      placeholder="Add a note for your client (optional)"
                      rows={2}
                      className="mt-2 w-full t-caption placeholder:text-[var(--brand-text-muted)] disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </>
                )
              )}
              {/* Version History toggle */}
              <Button
                onClick={() => setShowHistory(h => !h)}
                icon={History}
                variant="ghost"
                size="sm"
                className={cn(
                  'rounded-[var(--radius-md)] font-medium',
                  showHistory
                    ? 'bg-teal-500/15 text-teal-400 border border-teal-500/30'
                    : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)]'
                )}
                title="View publish version history"
              >
                History
              </Button>
            </div>

            {/* Stale schema warning */}
            {isStale && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-amber-500/5 border border-amber-500/20">
                <Icon as={Clock} size="md" className="text-amber-400/80 flex-shrink-0" />
                <span className="badge-span-ok t-caption-sm text-amber-300">
                  Schema published {staleDays} days ago — consider regenerating to reflect any content changes.
                </span>
              </div>
            )}

            {/* Version history panel */}
            {showHistory && (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
                <div className="t-caption font-medium text-[var(--brand-text-muted)] mb-2 flex items-center gap-1.5">
                  <Icon as={History} size="sm" /> Publish History
                </div>
                <SchemaVersionHistory
                  siteId={siteId}
                  pageId={page.pageId}
                  workspaceId={workspaceId}
                  onRestore={(restoredSchema) => {
                    onRestore(page.pageId, restoredSchema);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
