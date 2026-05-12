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
import { StatusBadge, Icon, cn } from '../ui';
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
        <button
          onClick={() => onToggleExpand(page.pageId)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
        >
          {isOpen ? <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" /> : <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="t-body font-medium text-[var(--brand-text-bright)] truncate">{page.pageTitle}</div>
            <div className="t-caption text-[var(--brand-text-muted)] truncate">/{page.slug}</div>
          </div>
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={editState?.status} />
          {page.existingSchemas.length > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
              <Icon as={CheckCircle} size="sm" /> {page.existingSchemas.length} existing
            </span>
          )}
          {graphTypes.length > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption bg-teal-500/10 text-teal-400 border border-teal-500/20">
              <Icon as={Sparkles} size="sm" /> {graphTypes.length} types
            </span>
          )}
          {eligibleCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20" title={`${eligibleCount} rich result type${eligibleCount > 1 ? 's' : ''} eligible`}>
              <Icon as={Star} size="sm" /> {eligibleCount} rich
            </span>
          )}
          {isStale && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption bg-amber-500/8 text-amber-400/80 border border-amber-500/20" title={`Published ${staleDays} days ago — consider refreshing`}>
              <Icon as={Clock} size="sm" /> {staleDays}d old
            </span>
          )}
          {hasErrors && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption bg-amber-500/8 text-amber-400/80 border border-amber-500/20">
              <Icon as={AlertCircle} size="sm" /> {page.validationErrors!.length}
            </span>
          )}
          {schemaRecs.length > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption bg-amber-500/8 text-amber-400/80 border border-amber-500/20">
              <Icon as={AlertTriangle} size="sm" /> {schemaRecs.length} rec{schemaRecs.length > 1 ? 's' : ''}
            </span>
          )}
          <select
            value={pageType}
            onChange={e => { e.stopPropagation(); onPageTypeChange(page.pageId, e.target.value); }}
            onClick={e => e.stopPropagation()}
            className="px-1.5 py-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] t-caption-sm text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 cursor-pointer"
            title="Page type hint for schema generation"
          >
            <option value="auto">Auto-detect</option>
            <option value="homepage">Homepage</option>
            <option value="pillar">Pillar / Product Page</option>
            <option value="service">Service Page</option>
            <option value="audience">Audience / Use Case</option>
            <option value="lead-gen">Lead-Gen / Conversion</option>
            <option value="blog">Blog Post</option>
            <option value="about">About / Team</option>
            <option value="contact">Contact</option>
            <option value="location">Location</option>
            <option value="product">Product</option>
            <option value="partnership">Partnership</option>
            <option value="faq">FAQ</option>
            <option value="case-study">Case Study</option>
            <option value="comparison">Comparison</option>
            <option value="author">Author Profile</option>
            <option value="howto">How-To / Tutorial</option>
            <option value="video">Video Page</option>
            <option value="job-posting">Job Posting</option>
            <option value="course">Course / Training</option>
            <option value="event">Event</option>
            <option value="review">Review</option>
            <option value="pricing">Pricing Page</option>
            <option value="recipe">Recipe</option>
            <option value="generic">General Page</option>
          </select>
          <button
            onClick={(e) => { e.stopPropagation(); onRegenerate(page.pageId); }}
            disabled={isRegenLoading}
            className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption font-medium transition-colors disabled:opacity-50 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)]"
            title="Regenerate schema for this page"
          >
            {isRegenLoading ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={RefreshCw} size="sm" />}
          </button>
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
                  <button
                    onClick={() => onToggleDiff(page.pageId)}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-md)] t-caption font-medium transition-colors',
                      showDiff
                        ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                        : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)]'
                    )}
                  >
                    <Icon as={GitCompareArrows} size="sm" />
                    {showDiff ? 'Hide Diff' : 'Show Diff'}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onToggleSchemaEdit(page.pageId, schema.template)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption font-medium transition-colors',
                    editingSchema
                      ? 'bg-teal-500/15 text-teal-400 border border-teal-500/30'
                      : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)]'
                  )}
                >
                  <Icon as={Pencil} size="sm" />
                  {editingSchema ? 'Done Editing' : 'Edit'}
                </button>
                <button
                  onClick={() => onCopyTemplate(schema, page.pageId)}
                  className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                >
                  {copiedId === `${page.pageId}-${schema.type}` ? (
                    <><Icon as={CheckCircle} size="sm" className="text-emerald-400/80" /> Copied</>
                  ) : (
                    <><Icon as={Copy} size="sm" /> Copy script</>
                  )}
                </button>
                <button
                  onClick={() => onCopyJsonLd(schema, page.pageId)}
                  className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption bg-blue-500/10 hover:bg-blue-500/15 text-blue-400 border border-blue-500/20 transition-colors"
                  title="Copy JSON only for Webflow Page Settings -> Schema markup"
                >
                  {copiedId === `${page.pageId}-${schema.type}-json` ? (
                    <><Icon as={CheckCircle} size="sm" className="text-emerald-400/80" /> JSON copied</>
                  ) : (
                    <><Icon as={Copy} size="sm" /> Copy JSON-LD</>
                  )}
                </button>
              </div>
            </div>

            {showDiff && page.existingSchemaJson ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="t-caption-sm font-medium text-red-400/80 mb-1 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-[var(--radius-pill)] bg-red-400/60" /> Current (on page)
                  </div>
                  <pre className="t-caption font-mono bg-[var(--surface-1)] rounded-[var(--radius-md)] p-3 overflow-x-auto text-[var(--brand-text-muted)] border border-red-500/20 max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {JSON.stringify(page.existingSchemaJson.length === 1 ? page.existingSchemaJson[0] : page.existingSchemaJson, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="t-caption-sm font-medium text-emerald-400/80 mb-1 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-[var(--radius-pill)] bg-emerald-400/60" /> Suggested <Icon as={ArrowRight} size="sm" />
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
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
                  <Icon as={ShieldCheck} size="sm" /> Schema valid
                </span>
              )}
              {validationStatus === 'warnings' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption bg-amber-500/8 text-amber-400/80 border border-amber-500/20">
                  <Icon as={AlertTriangle} size="sm" /> Warnings
                </span>
              )}
              {validationStatus === 'errors' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption bg-red-500/8 text-red-400/80 border border-red-500/20" title="Fix errors before publishing">
                  <Icon as={XCircle} size="sm" /> Fix errors to publish
                </span>
              )}
              {!page.pageId.startsWith('cms-') && (
                published ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
                    <Icon as={CheckCircle} size="md" /> Published to Webflow
                  </span>
                ) : confirmPublish ? (
                  <div className="flex items-center gap-2">
                    <span className="t-caption text-amber-400/80">Publish {editedSchemaJson ? 'edited ' : ''}schema to this page&apos;s &lt;head&gt;?</span>
                    <button
                      onClick={() => onPublish(page.pageId, getEffectiveSchema(page.pageId, schema.template))}
                      disabled={publishing || !!schemaParseError || validationStatus === 'errors'}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium transition-colors disabled:opacity-50 bg-emerald-600 hover:bg-emerald-500 text-white"
                    >
                      {publishing ? <Icon as={Loader2} size="md" className="animate-spin" /> : <Icon as={Upload} size="md" />}
                      Yes, publish
                    </button>
                    <button
                      onClick={() => onConfirmPublish(null)}
                      className="px-2 py-1.5 rounded-[var(--radius-md)] t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    // pr-check-disable-next-line -- publish action with loading state
                    onClick={() => onConfirmPublish(page.pageId)}
                    disabled={publishing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium transition-colors disabled:opacity-50 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white"
                  >
                    {publishing ? (
                      <><Icon as={Loader2} size="md" className="animate-spin" /> Publishing...</>
                    ) : (
                      <><Icon as={Upload} size="md" /> Publish to Webflow</>
                    )}
                  </button>
                )
              )}
              {isHomepage && (
                templateSaved ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
                    <Icon as={CheckCircle} size="md" /> Template Saved
                  </span>
                ) : (
                  <button
                    onClick={() => onSaveAsTemplate(page.pageId)}
                    disabled={savingTemplate}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium transition-colors disabled:opacity-50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    title="Save Organization + WebSite nodes as the site-wide template for subpages"
                  >
                    {savingTemplate ? (
                      <><Icon as={Loader2} size="md" className="animate-spin" /> Saving...</>
                    ) : (
                      <><Icon as={Save} size="md" /> Save as Site Template</>
                    )}
                  </button>
                )
              )}
              {published && !retracted && (
                <button
                  onClick={() => onRetract(page.pageId)}
                  disabled={retracting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium transition-colors disabled:opacity-50 bg-red-500/8 hover:bg-red-500/15 text-red-400/80 border border-red-500/30"
                >
                  {retracting ? <Icon as={Loader2} size="md" className="animate-spin" /> : <Icon as={Trash2} size="md" />}
                  Retract
                </button>
              )}
              {retracted && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-[var(--surface-3)]/10 text-[var(--brand-text-muted)] border border-[var(--brand-border)]/20">
                  <Icon as={Trash2} size="md" /> Retracted
                </span>
              )}
              {publishError && (
                <span className="t-caption text-red-400/80">{publishError}</span>
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
                        <button
                          onClick={() => onCopyJsonLd(schema, page.pageId)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption bg-amber-500/12 hover:bg-amber-500/18 text-amber-200 border border-amber-500/25 transition-colors"
                        >
                          {copiedId === `${page.pageId}-${schema.type}-json` ? (
                            <><Icon as={CheckCircle} size="sm" /> JSON copied</>
                          ) : (
                            <><Icon as={Copy} size="sm" /> Copy JSON-LD</>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {workspaceId && (
                sentPage ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                    <Icon as={CheckCircle} size="md" /> Sent for Approval
                  </span>
                ) : (
                  <>
                    <button
                      onClick={() => onSendToClient(page, pageNote.trim() || undefined)}
                      disabled={sendingPage}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium transition-colors disabled:opacity-50 bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/30"
                    >
                      {sendingPage ? (
                        <><Icon as={Loader2} size="md" className="animate-spin" /> Sending...</>
                      ) : (
                        <><Icon as={Send} size="md" /> Send to Client</>
                      )}
                    </button>
                    <textarea
                      value={pageNote}
                      onChange={e => setPageNote(e.target.value)}
                      disabled={sendingPage}
                      maxLength={2000}
                      placeholder="Add a note for your client (optional)"
                      rows={2}
                      className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 t-caption text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] resize-none focus:outline-none focus:border-[var(--brand-border-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </>
                )
              )}
              {/* Version History toggle */}
              <button
                onClick={() => setShowHistory(h => !h)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium transition-colors',
                  showHistory
                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)]'
                )}
                title="View publish version history"
              >
                <Icon as={History} size="md" />
                History
              </button>
            </div>

            {/* Stale schema warning */}
            {isStale && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-amber-500/5 border border-amber-500/20">
                <Icon as={Clock} size="md" className="text-amber-400/80 flex-shrink-0" />
                <span className="t-caption-sm text-amber-300">
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
