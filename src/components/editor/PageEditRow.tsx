/**
 * PageEditRow — Per-page expandable row with SEO edit fields.
 * Extracted from SeoEditor.tsx page list rendering.
 */
import {
  Loader2, Save, Sparkles, ChevronDown, ChevronRight,
  Check, AlertTriangle, CheckSquare, Square, Send, X, Search,
} from 'lucide-react';
import { StatusBadge, CharacterCounter, SerpPreview, SocialPreview, SectionCard, Icon } from '../ui';
import { statusBorderClass } from '../ui/statusConfig';
import type {
  SeoEditState,
  SeoEditorPage,
  SeoPageState,
  SeoRecommendation,
  SeoVariationSet,
} from './seoEditorTypes';

export interface PageEditRowProps {
  page: SeoEditorPage;
  edit: SeoEditState | undefined;
  expanded: boolean;
  isSaving: boolean;
  isSaved: boolean;
  isAiLoading: string | undefined;
  isDraftSaving?: boolean;
  isDraftSaved?: boolean;
  isSelected: boolean;
  pageRecs: SeoRecommendation[];
  pageState: SeoPageState | undefined;
  variations: SeoVariationSet | undefined;
  showApprovalCheckbox: boolean;
  isSendingToClient: boolean;
  isSentToClient: boolean;
  hasChanges: boolean;
  onSendToClient: (pageId: string) => void;
  onToggleExpand: (id: string) => void;
  onToggleApprovalSelect: (id: string) => void;
  onUpdateField: (pageId: string, field: 'seoTitle' | 'seoDescription', value: string) => void;
  onSave?: (pageId: string) => void;
  isCmsPage?: boolean;
  onSaveDraft?: (pageId: string) => void;
  onAiRewrite: (pageId: string, field: 'title' | 'description' | 'both') => void;
  onSelectVariation: (pageId: string, field: 'seoTitle' | 'seoDescription', value: string) => void;
  onClearVariations: (pageId: string) => void;
  onClearTracking?: (pageId: string) => void;
  errorState?: { type: string; message: string } | null;
  showPreview?: boolean;
  onTogglePreview?: (pageId: string) => void;
  onAnalyzePage?: (pageId: string) => void;
  hasAnalysis?: boolean;
  isAnalyzing?: boolean;
  /** Target keywords for this page — shown in the collapsed row so the editor knows what not to remove */
  primaryKeyword?: string;
  secondaryKeywords?: string[];
}

export function PageEditRow({
  page, edit, expanded, isSaving, isSaved, isAiLoading, isDraftSaving, isDraftSaved, isSelected,
  pageRecs, pageState, variations, showApprovalCheckbox,
  isSendingToClient, isSentToClient, hasChanges, onSendToClient,
  onToggleExpand, onToggleApprovalSelect, onUpdateField, onSave, isCmsPage, onSaveDraft,
  onAiRewrite, onSelectVariation, onClearVariations, onClearTracking, errorState,
  showPreview, onTogglePreview, onAnalyzePage, hasAnalysis, isAnalyzing,
  primaryKeyword, secondaryKeywords,
}: PageEditRowProps) {
  const hasSeoTitle = !!(page.seo?.title);
  const hasSeoDesc = !!(page.seo?.description);
  const metaRecs = pageRecs.filter(r => r.type === 'metadata');
  const hasRecFlag = metaRecs.length > 0;
  const trackingBorder = statusBorderClass(pageState?.status as any);

  return (
    <div id={`seo-editor-page-${page.id}`}>
    <SectionCard
      noPadding
      className={`overflow-hidden ${trackingBorder || (hasRecFlag ? '!border-amber-500/30' : isSelected ? '!border-teal-500/40 !bg-teal-500/5' : '')}`}
    >
      <div className="flex items-center">
        {showApprovalCheckbox && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleApprovalSelect(page.id); }}
            className="pl-4 pr-1 py-3 text-[var(--brand-text-muted)] hover:text-teal-400 transition-colors"
          >
            {isSelected ? <Icon as={CheckSquare} size="md" className="text-teal-400" /> : <Icon as={Square} size="md" />}
          </button>
        )}
      <button
        onClick={() => onToggleExpand(page.id)}
        className="flex-1 flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-2)]/50 transition-colors text-left"
      >
        {expanded ? <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)]" /> : <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)]" />}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--brand-text-bright)] truncate">{page.title}</div>
          <div className="text-xs text-[var(--brand-text-muted)] truncate">/{page.slug}</div>
          {(primaryKeyword || (secondaryKeywords?.length ?? 0) > 0) && (
            <div className="flex items-center gap-1 flex-wrap mt-0.5">
              {primaryKeyword && (
                <span className="t-micro px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-400 font-medium" title={primaryKeyword}>
                  {primaryKeyword}
                </span>
              )}
              {secondaryKeywords?.slice(0, 3).map(kw => (
                <span key={kw} className="t-micro px-1.5 py-0.5 rounded bg-[var(--surface-3)]/60 border border-[var(--brand-border)] text-[var(--brand-text)]" title={kw}>
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={pageState?.status as any} size="sm" />
          {pageState?.status && onClearTracking && (
            <button
              onClick={(e) => { e.stopPropagation(); onClearTracking(page.id); }}
              className="flex items-center gap-0.5 t-caption-sm px-1.5 py-0.5 rounded text-[var(--brand-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Clear page tracking status"
            >
              <Icon as={X} size="sm" /> clear
            </button>
          )}
          {hasRecFlag && (
            <span className="flex items-center gap-1 t-caption-sm px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Icon as={AlertTriangle} size="sm" />
              {metaRecs.length === 1 ? metaRecs[0].title.length > 20 ? `${metaRecs[0].title.slice(0, 20)}...` : metaRecs[0].title : `${metaRecs.length} issues`}
            </span>
          )}
          {!hasSeoTitle && !hasRecFlag && <span className="t-caption-sm px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">Missing title</span>}
          {!hasSeoDesc && !hasRecFlag && <span className="t-caption-sm px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">Missing meta</span>}
          {edit?.dirty && <span className="t-caption-sm px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400">Unsaved</span>}
        </div>
      </button>
      <button
        onClick={() => onTogglePreview?.(page.id)}
        className="flex items-center gap-1 px-2 py-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors"
        title="Toggle preview"
      >
        👁️ Preview
      </button>
      </div>

      {expanded && edit && (
        <div className="px-4 pb-4 space-y-3 bg-[var(--surface-2)]/30">
          {/* Recommendation banners */}
          {metaRecs.map(rec => (
            <div key={rec.id} className="flex items-start gap-2.5 px-3 py-2 rounded-[var(--radius-lg)] bg-amber-500/5 border border-amber-500/20">
              <Icon as={AlertTriangle} size="md" className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium text-amber-300">{rec.title}</div>
                  {rec.trafficAtRisk > 0 && (
                    <span className="t-caption-sm text-amber-400/70">
                      {rec.trafficAtRisk.toLocaleString()} clicks at risk
                    </span>
                  )}
                </div>
                <div className="t-caption-sm text-[var(--brand-text)] mt-1">{rec.insight}</div>
                {rec.estimatedGain && (
                  <div className="t-caption-sm text-emerald-400/70 mt-1">
                    Potential: {rec.estimatedGain}
                  </div>
                )}
              </div>
              <span className={`flex-shrink-0 t-caption-sm px-1.5 py-0.5 rounded font-medium ${
                rec.priority === 'fix_now' ? 'bg-red-500/15 text-red-400' :
                rec.priority === 'fix_soon' ? 'bg-amber-500/15 text-amber-400' :
                'bg-[var(--brand-text-muted)]/15 text-[var(--brand-text)]'
              }`}>
                {rec.priority === 'fix_now' ? 'Now' : rec.priority === 'fix_soon' ? 'Soon' : 'Later'}
              </span>
            </div>
          ))}
          {/* Error State */}
          {errorState && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-[var(--radius-lg)] bg-red-500/5 border border-red-500/20">
              <Icon as={AlertTriangle} size="md" className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-red-300">{errorState.type === 'network' ? 'Connection Error' : errorState.type === 'permission' ? 'Permission Error' : 'Error'}</div>
                <div className="t-caption-sm text-[var(--brand-text)] mt-0.5">{errorState.message}</div>
              </div>
            </div>
          )}

          {/* Analyze + Generate buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {onAnalyzePage && (
                <button
                  onClick={() => onAnalyzePage(page.id)}
                  disabled={isAnalyzing}
                  className="flex items-center gap-1 px-2 py-1 t-caption-sm bg-purple-600/80 hover:bg-purple-500/80 text-white font-medium rounded transition-colors disabled:opacity-50"
                  title={hasAnalysis ? 'Re-analyze page (update recommendations)' : 'Run page analysis to generate optimization recommendations'}
                >
                  <Icon as={isAnalyzing ? Loader2 : Search} size="sm" className={isAnalyzing ? 'animate-spin' : ''} />
                  {hasAnalysis ? 'Re-analyze' : 'Analyze Page'}
                </button>
              )}
              {hasAnalysis && (
                <span className="t-caption-sm text-emerald-400/70 flex items-center gap-1">
                  <Icon as={Check} size="sm" /> Analysis on file
                </span>
              )}
            </div>
            <button
              onClick={() => onAiRewrite(page.id, 'both')}
              disabled={!!isAiLoading}
              className="flex items-center gap-1 t-caption-sm bg-teal-600 hover:bg-teal-500 text-white font-medium px-2 py-1 rounded transition-colors disabled:opacity-50"
              title={hasAnalysis ? 'Generate paired title + description (using page analysis)' : 'Generate paired title + description'}
            >
              <Icon as={isAiLoading === 'both' ? Loader2 : Sparkles} size="sm" className={isAiLoading === 'both' ? 'animate-spin' : ''} />
              AI Generate Both
            </button>
          </div>

          {/* Paired variation picker (when both were generated together) */}
          {variations?.field === 'both' && variations.options.length > 1 && variations.descOptions && (
            <div className="space-y-1.5 border border-teal-500/20 bg-teal-500/5 rounded-[var(--radius-lg)] p-3">
              <div className="t-caption-sm text-teal-400 font-medium">Pick a paired title + description:</div>
              {variations.options.map((titleV, i) => {
                const descV = variations.descOptions![i] || '';
                const isSelected = edit.seoTitle === titleV && edit.seoDescription === descV;
                return (
                  <button
                    key={i}
                    onClick={() => {
                      onSelectVariation(page.id, 'seoTitle', titleV);
                      onSelectVariation(page.id, 'seoDescription', descV);
                      onClearVariations(page.id);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-[var(--radius-lg)] text-xs border transition-colors ${
                      isSelected
                        ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                        : 'bg-[var(--surface-3)]/60 border-[var(--brand-border)]/50 text-[var(--brand-text-bright)] hover:border-teal-500/30 hover:bg-teal-600/10'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[var(--brand-text-muted)] font-bold">{i + 1}.</span>
                      <span className="t-caption-sm px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">Title</span>
                      <span className="flex-1">{titleV}</span>
                      <CharacterCounter current={titleV.length} max={60} size="sm" />
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <span className="t-caption-sm px-1 py-0.5 rounded bg-purple-500/10 text-purple-400">Desc</span>
                      <span className="flex-1 text-[var(--brand-text)]">{descV}</span>
                      <CharacterCounter current={descV.length} max={160} size="sm" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* SEO Title */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--brand-text)]">SEO Title</label>
              <div className="flex items-center gap-1">
                <CharacterCounter current={edit.seoTitle.length} max={60} size="sm" />
                <button
                  onClick={() => onAiRewrite(page.id, 'title')}
                  disabled={!!isAiLoading}
                  className="flex items-center gap-1 px-1.5 py-0.5 t-caption-sm bg-teal-600/50 hover:bg-teal-500/50 rounded transition-colors disabled:opacity-50"
                  title="AI rewrite title only"
                >
                  <Icon as={isAiLoading === 'title' ? Loader2 : Sparkles} size="sm" className={isAiLoading === 'title' ? 'animate-spin' : ''} />
                  AI
                </button>
              </div>
            </div>
            <input
              type="text"
              value={edit.seoTitle}
              onChange={e => onUpdateField(page.id, 'seoTitle', e.target.value)}
              placeholder="Enter SEO title..."
              className="w-full px-3 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded text-sm text-[var(--brand-text-bright)] focus:outline-none focus:border-[var(--brand-border-hover)]"
            />
            {variations?.field === 'title' && variations.options.length > 1 && (
              <div className="mt-1.5 space-y-1">
                <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium">Pick a variation:</div>
                {variations.options.map((v, i) => (
                  <button
                    key={i}
                    onClick={() => { onSelectVariation(page.id, 'seoTitle', v); onClearVariations(page.id); }}
                    className={`w-full text-left px-3 py-1.5 rounded text-xs border transition-colors ${
                      edit.seoTitle === v
                        ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                        : 'bg-[var(--surface-3)]/60 border-[var(--brand-border)]/50 text-[var(--brand-text-bright)] hover:border-teal-500/30 hover:bg-teal-600/10'
                    }`}
                  >
                    <span className="text-[var(--brand-text-muted)] mr-1.5">{i + 1}.</span>{v}
                    <CharacterCounter current={v.length} max={60} size="sm" className="ml-2" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Meta Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--brand-text)]">Meta Description</label>
              <div className="flex items-center gap-1">
                <CharacterCounter current={edit.seoDescription.length} max={160} size="sm" />
                <button
                  onClick={() => onAiRewrite(page.id, 'description')}
                  disabled={!!isAiLoading}
                  className="flex items-center gap-1 px-1.5 py-0.5 t-caption-sm bg-teal-600/50 hover:bg-teal-500/50 rounded transition-colors disabled:opacity-50"
                  title="AI rewrite description only"
                >
                  <Icon as={isAiLoading === 'description' ? Loader2 : Sparkles} size="sm" className={isAiLoading === 'description' ? 'animate-spin' : ''} />
                  AI
                </button>
              </div>
            </div>
            <textarea
              value={edit.seoDescription}
              onChange={e => onUpdateField(page.id, 'seoDescription', e.target.value)}
              placeholder="Enter meta description..."
              rows={2}
              className="w-full px-3 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded text-sm text-[var(--brand-text-bright)] focus:outline-none focus:border-[var(--brand-border-hover)] resize-none"
            />
            {variations?.field === 'description' && variations.options.length > 1 && (
              <div className="mt-1.5 space-y-1">
                <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium">Pick a variation:</div>
                {variations.options.map((v, i) => (
                  <button
                    key={i}
                    onClick={() => { onSelectVariation(page.id, 'seoDescription', v); onClearVariations(page.id); }}
                    className={`w-full text-left px-3 py-1.5 rounded text-xs border transition-colors ${
                      edit.seoDescription === v
                        ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                        : 'bg-[var(--surface-3)]/60 border-[var(--brand-border)]/50 text-[var(--brand-text-bright)] hover:border-teal-500/30 hover:bg-teal-600/10'
                    }`}
                  >
                    <span className="text-[var(--brand-text-muted)] mr-1.5">{i + 1}.</span>{v}
                    <CharacterCounter current={v.length} max={160} size="sm" className="ml-2" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-2">
            {showApprovalCheckbox && (
              <button
                onClick={() => onSendToClient(page.id)}
                disabled={!hasChanges || isSendingToClient}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] text-xs font-medium transition-colors ${
                  isSentToClient ? 'bg-emerald-600 text-white' : 'bg-cyan-600/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-600/30 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                <Icon as={isSendingToClient ? Loader2 : isSentToClient ? Check : Send} size="sm" className={isSendingToClient ? 'animate-spin' : ''} />
                {isSentToClient ? 'Sent!' : isSendingToClient ? 'Sending...' : 'Send to Client'}
              </button>
            )}
            {onSaveDraft && (
              <button
                onClick={() => onSaveDraft(page.id)}
                disabled={!edit.dirty || isDraftSaving}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] text-xs font-medium transition-colors ${
                  isDraftSaved ? 'bg-blue-600 text-white' : 'bg-[var(--surface-3)] text-[var(--brand-text-bright)] hover:bg-[var(--brand-border-hover)] disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                <Icon as={isDraftSaving ? Loader2 : isDraftSaved ? Check : Save} size="sm" className={isDraftSaving ? 'animate-spin' : ''} />
                {isDraftSaved ? 'Draft Saved!' : isDraftSaving ? 'Saving...' : 'Save Draft'}
              </button>
            )}
            <button
              onClick={() => onSave?.(page.id)}
              disabled={!edit.dirty || isSaving || !onSave}
              title={!onSave && isCmsPage ? 'CMS pages must be updated directly in Webflow' : undefined}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-lg)] text-xs font-medium transition-colors ${
                isSaved ? 'bg-emerald-600 text-white' : 'bg-white text-black hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              <Icon as={isSaving ? Loader2 : isSaved ? Check : Save} size="sm" className={isSaving ? 'animate-spin' : ''} />
              {isSaved ? 'Saved!' : isSaving ? 'Saving...' : 'Save to Webflow'}
            </button>
          </div>
        </div>
      )}

      {/* Preview Section */}
      {showPreview && (
        <div className="border-t border-[var(--brand-border)] p-4 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-[var(--brand-text-bright)]">Preview</h4>
            <button
              onClick={() => onTogglePreview?.(page.id)}
              className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] text-xs"
            >
              Hide
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Google Search Preview */}
            <div>
              <div className="text-xs font-medium text-[var(--brand-text)] mb-2">Google Search</div>
              <SerpPreview
                title={edit?.seoTitle || page.title}
                description={edit?.seoDescription || ''}
                url={page.publishedPath || `/${page.slug}`}
                siteName="Your Site"
                size="sm"
              />
            </div>
            
            {/* Social Media Preview */}
            <div>
              <div className="text-xs font-medium text-[var(--brand-text)] mb-2">Facebook</div>
              <SocialPreview
                title={edit?.seoTitle || page.title}
                description={edit?.seoDescription || ''}
                siteName="Your Site"
                platform="facebook"
                size="sm"
              />
            </div>
          </div>
        </div>
      )}
    </SectionCard>
    </div>
  );
}
