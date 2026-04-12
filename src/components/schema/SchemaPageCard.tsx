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
import { StatusBadge } from '../ui/StatusBadge';
import { statusBorderClass, type PageEditStatus } from '../ui/statusConfig';
import { SchemaEditor } from './SchemaEditor';
import { SchemaVersionHistory } from './SchemaVersionHistory';

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

interface Recommendation {
  id: string;
  type: string;
  title: string;
  insight: string;
  priority: string;
  trafficAtRisk: number;
  estimatedGain: string;
}

export interface SchemaPageCardProps {
  page: SchemaPageSuggestion;
  isOpen: boolean;
  isRegenLoading: boolean;
  editState: { status: PageEditStatus | null | undefined } | undefined;
  copiedId: string | null;
  published: boolean;
  publishing: boolean;
  publishError: string | undefined;
  confirmPublish: boolean;
  sentPage: boolean;
  sendingPage: boolean;
  editingSchema: boolean;
  editedSchemaJson: string | undefined;
  schemaParseError: string | undefined;
  showDiff: boolean;
  schemaRecs: Recommendation[];
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
  onPublish: (pageId: string, schema: Record<string, unknown>) => void;
  onConfirmPublish: (pageId: string | null) => void;
  onSendToClient: (page: SchemaPageSuggestion) => void;
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
  published, publishing, publishError, confirmPublish,
  sentPage, sendingPage, editingSchema, editedSchemaJson,
  schemaParseError, showDiff, schemaRecs, workspaceId,
  pageType, isHomepage, savingTemplate, templateSaved,
  onPageTypeChange,
  onToggleExpand, onRegenerate, onToggleDiff, onToggleSchemaEdit,
  onSchemaJsonChange, onCopyTemplate, onPublish, onConfirmPublish,
  onSendToClient, onSaveAsTemplate, onRetract, retracting, retracted,
  getEffectiveSchema, siteId, onRestore, validationStatus,
}: SchemaPageCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const hasErrors = (page.validationErrors?.length || 0) > 0;
  const schema = page.suggestedSchemas[0];
  const graphTypes = schema ? ((schema.template?.['@graph'] as Record<string, unknown>[]) || []).map(n => n['@type'] as string).filter(Boolean) : [];
  const eligibleCount = page.richResultsEligibility?.filter(r => r.eligible).length || 0;

  // Stale schema detection: published > 90 days ago
  const staleDays = page.lastPublishedAt
    ? Math.floor((Date.now() - new Date(page.lastPublishedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isStale = staleDays !== null && staleDays > 90;

  return (
    <div className={`bg-zinc-900 border overflow-hidden ${statusBorderClass(editState?.status) || (hasErrors ? 'border-amber-500/30' : 'border-zinc-800')}`} style={{ borderRadius: '10px 24px 10px 24px' }}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => onToggleExpand(page.pageId)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
        >
          {isOpen ? <ChevronDown className="w-4 h-4 text-zinc-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-zinc-200 truncate">{page.pageTitle}</div>
            <div className="text-xs text-zinc-500 truncate">/{page.slug}</div>
          </div>
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={editState?.status} />
          {page.existingSchemas.length > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
              <CheckCircle className="w-3 h-3" /> {page.existingSchemas.length} existing
            </span>
          )}
          {graphTypes.length > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-teal-500/10 text-teal-400 border border-teal-500/20">
              <Sparkles className="w-3 h-3" /> {graphTypes.length} types
            </span>
          )}
          {eligibleCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20" title={`${eligibleCount} rich result type${eligibleCount > 1 ? 's' : ''} eligible`}>
              <Star className="w-3 h-3" /> {eligibleCount} rich
            </span>
          )}
          {isStale && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/8 text-amber-400/80 border border-amber-500/20" title={`Published ${staleDays} days ago — consider refreshing`}>
              <Clock className="w-3 h-3" /> {staleDays}d old
            </span>
          )}
          {hasErrors && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/8 text-amber-400/80 border border-amber-500/20">
              <AlertCircle className="w-3 h-3" /> {page.validationErrors!.length}
            </span>
          )}
          {schemaRecs.length > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/8 text-amber-400/80 border border-amber-500/20">
              <AlertTriangle className="w-3 h-3" /> {schemaRecs.length} rec{schemaRecs.length > 1 ? 's' : ''}
            </span>
          )}
          <select
            value={pageType}
            onChange={e => { e.stopPropagation(); onPageTypeChange(page.pageId, e.target.value); }}
            onClick={e => e.stopPropagation()}
            className="px-1.5 py-1 bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-400 focus:outline-none focus:border-teal-500 cursor-pointer"
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
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50 text-zinc-500 hover:text-zinc-300 bg-zinc-800 hover:bg-zinc-700"
            title="Regenerate schema for this page"
          >
            {isRegenLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {isOpen && schema && (
        <div className="border-t border-zinc-800">
          {/* Existing schemas */}
          {page.existingSchemas.length > 0 && (
            <div className="px-4 py-3 border-b border-zinc-800/50">
              <div className="text-xs font-medium text-zinc-400 mb-2">Already on page</div>
              <div className="flex flex-wrap gap-1.5">
                {page.existingSchemas.map((s, i) => (
                  <span key={i} className="px-2 py-1 rounded-md text-xs font-mono bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Validation errors */}
          {hasErrors && (
            <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/20">
              <div className="text-xs font-medium text-amber-400/80 mb-1">Validation warnings</div>
              {page.validationErrors!.map((err, i) => (
                <div key={i} className="text-[11px] text-amber-300/80">• {err}</div>
              ))}
            </div>
          )}

          {/* Recommendation banners */}
          {schemaRecs.length > 0 && (
            <div className="px-4 py-2 border-b border-amber-500/20 bg-amber-500/5 space-y-1.5">
              {schemaRecs.map(rec => (
                <div key={rec.id} className="flex items-start gap-2">
                  <AlertTriangle className="w-3 h-3 text-amber-400/80 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium text-amber-300">{rec.title}</div>
                    <div className="text-[11px] text-zinc-400">{rec.insight}</div>
                    {rec.trafficAtRisk > 0 && (
                      <div className="text-[10px] text-amber-400/70 mt-0.5">
                        {rec.trafficAtRisk.toLocaleString()} clicks at risk · {rec.estimatedGain}
                      </div>
                    )}
                  </div>
                  <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    rec.priority === 'fix_now' ? 'bg-red-500/15 text-red-400/80' :
                    rec.priority === 'fix_soon' ? 'bg-amber-500/15 text-amber-400/80' :
                    'bg-zinc-500/15 text-zinc-400'
                  }`}>
                    {rec.priority.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Graph types */}
          <div className="px-4 py-2 border-b border-zinc-800/50">
            <div className="text-xs font-medium text-zinc-400 mb-1.5">@graph types</div>
            <div className="flex flex-wrap gap-1.5">
              {graphTypes.map((t, i) => (
                <span key={i} className="px-2 py-1 rounded-md text-xs font-mono bg-teal-500/10 text-teal-300 border border-teal-500/20">
                  {t}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1.5">{schema.reason}</p>
          </div>

          {/* Rich Results Eligibility */}
          {page.richResultsEligibility && page.richResultsEligibility.length > 0 && (
            <div className="px-4 py-2 border-b border-zinc-800/50">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Star className="w-3 h-3 text-amber-400/80" />
                <div className="text-xs font-medium text-zinc-400">Rich Results</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {page.richResultsEligibility.map((r, i) => (
                  r.eligible ? (
                    <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20" title={`Eligible for: ${r.feature}`}>
                      <CheckCircle className="w-3 h-3 flex-shrink-0" />
                      {r.type}: {r.feature}
                    </span>
                  ) : (
                    <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-amber-500/8 text-amber-400/80 border border-amber-500/20" title={`Missing for ${r.feature}: ${r.missingFields?.join(', ')}`}>
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      {r.type}: missing {r.missingFields?.join(', ')}
                    </span>
                  )
                ))}
              </div>
            </div>
          )}

          {/* Schema preview / diff / editor */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {page.existingSchemaJson && page.existingSchemaJson.length > 0 && (
                  <button
                    onClick={() => onToggleDiff(page.pageId)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                      showDiff
                        ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                        : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    <GitCompareArrows className="w-3 h-3" />
                    {showDiff ? 'Hide Diff' : 'Show Diff'}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onToggleSchemaEdit(page.pageId, schema.template)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    editingSchema
                      ? 'bg-teal-500/15 text-teal-400 border border-teal-500/30'
                      : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  <Pencil className="w-3 h-3" />
                  {editingSchema ? 'Done Editing' : 'Edit'}
                </button>
                <button
                  onClick={() => onCopyTemplate(schema, page.pageId)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {copiedId === `${page.pageId}-${schema.type}` ? (
                    <><CheckCircle className="w-3 h-3 text-emerald-400/80" /> Copied</>
                  ) : (
                    <><Copy className="w-3 h-3" /> Copy</>
                  )}
                </button>
              </div>
            </div>

            {showDiff && page.existingSchemaJson ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] font-medium text-red-400/80 mb-1 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-400/60" /> Current (on page)
                  </div>
                  <pre className="text-xs font-mono bg-zinc-950 rounded-lg p-3 overflow-x-auto text-zinc-500 border border-red-500/20 max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {JSON.stringify(page.existingSchemaJson.length === 1 ? page.existingSchemaJson[0] : page.existingSchemaJson, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-emerald-400/80 mb-1 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400/60" /> Suggested <ArrowRight className="w-3 h-3" />
                  </div>
                  <pre className="text-xs font-mono bg-zinc-950 rounded-lg p-3 overflow-x-auto text-zinc-400 border border-green-500/20 max-h-64 overflow-y-auto whitespace-pre-wrap">
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
              <pre className="text-xs font-mono bg-zinc-950 rounded-lg p-3 overflow-x-auto text-zinc-400 border border-zinc-800 max-h-64 overflow-y-auto">
                {JSON.stringify(getEffectiveSchema(page.pageId, schema.template), null, 2)}
              </pre>
            )}

            {/* Publish to Webflow */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {/* Validation status badge */}
              {validationStatus === 'valid' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
                  <ShieldCheck className="w-3 h-3" /> Schema valid
                </span>
              )}
              {validationStatus === 'warnings' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/8 text-amber-400/80 border border-amber-500/20">
                  <AlertTriangle className="w-3 h-3" /> Warnings
                </span>
              )}
              {validationStatus === 'errors' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-500/8 text-red-400/80 border border-red-500/20" title="Fix errors before publishing">
                  <XCircle className="w-3 h-3" /> Fix errors to publish
                </span>
              )}
              {!page.pageId.startsWith('cms-') && (
                published ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
                    <CheckCircle className="w-3.5 h-3.5" /> Published to Webflow
                  </span>
                ) : confirmPublish ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-amber-400/80">Publish {editedSchemaJson ? 'edited ' : ''}schema to this page&apos;s &lt;head&gt;?</span>
                    <button
                      onClick={() => onPublish(page.pageId, getEffectiveSchema(page.pageId, schema.template))}
                      disabled={publishing || !!schemaParseError || validationStatus === 'errors'}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 bg-green-600 hover:bg-green-500 text-white"
                    >
                      {publishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                      Yes, publish
                    </button>
                    <button
                      onClick={() => onConfirmPublish(null)}
                      className="px-2 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => onConfirmPublish(page.pageId)}
                    disabled={publishing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white"
                  >
                    {publishing ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Publishing...</>
                    ) : (
                      <><Upload className="w-3.5 h-3.5" /> Publish to Webflow</>
                    )}
                  </button>
                )
              )}
              {isHomepage && (
                templateSaved ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
                    <CheckCircle className="w-3.5 h-3.5" /> Template Saved
                  </span>
                ) : (
                  <button
                    onClick={() => onSaveAsTemplate(page.pageId)}
                    disabled={savingTemplate}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    title="Save Organization + WebSite nodes as the site-wide template for subpages"
                  >
                    {savingTemplate ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</>
                    ) : (
                      <><Save className="w-3.5 h-3.5" /> Save as Site Template</>
                    )}
                  </button>
                )
              )}
              {published && !retracted && (
                <button
                  onClick={() => onRetract(page.pageId)}
                  disabled={retracting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 bg-red-500/8 hover:bg-red-500/15 text-red-400/80 border border-red-500/30"
                >
                  {retracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Retract
                </button>
              )}
              {retracted && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                  <Trash2 className="w-3.5 h-3.5" /> Retracted
                </span>
              )}
              {publishError && (
                <span className="text-xs text-red-400/80">{publishError}</span>
              )}
              {workspaceId && (
                sentPage ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                    <CheckCircle className="w-3.5 h-3.5" /> Sent for Approval
                  </span>
                ) : (
                  <button
                    onClick={() => onSendToClient(page)}
                    disabled={sendingPage}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/30"
                  >
                    {sendingPage ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Sending...</>
                    ) : (
                      <><Send className="w-3.5 h-3.5" /> Send to Client</>
                    )}
                  </button>
                )
              )}
              {/* Version History toggle */}
              <button
                onClick={() => setShowHistory(h => !h)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  showHistory
                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                }`}
                title="View publish version history"
              >
                <History className="w-3.5 h-3.5" />
                History
              </button>
            </div>

            {/* Stale schema warning */}
            {isStale && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <Clock className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
                <span className="text-[11px] text-amber-300">
                  Schema published {staleDays} days ago — consider regenerating to reflect any content changes.
                </span>
              </div>
            )}

            {/* Version history panel */}
            {showHistory && (
              <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs font-medium text-zinc-400 mb-2 flex items-center gap-1.5">
                  <History className="w-3 h-3" /> Publish History
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
