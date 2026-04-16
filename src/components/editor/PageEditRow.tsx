/**
 * PageEditRow — Per-page expandable row with SEO edit fields.
 * Extracted from SeoEditor.tsx page list rendering.
 */
import {
  Loader2, Save, Sparkles, ChevronDown, ChevronRight,
  Check, AlertTriangle, CheckSquare, Square, Send, X, Search,
} from 'lucide-react';
import { StatusBadge, CharacterCounter, SerpPreview, SocialPreview } from '../ui';
import { statusBorderClass } from '../ui/statusConfig';

interface PageMeta {
  id: string;
  title: string;
  slug: string;
  publishedPath?: string | null;
  seo?: { title?: string | null; description?: string | null };
  openGraph?: { title?: string; description?: string; titleCopied?: boolean; descriptionCopied?: boolean };
  source?: 'static' | 'cms';
  collectionId?: string;
}

interface EditState {
  seoTitle: string;
  seoDescription: string;
  dirty: boolean;
}

interface Recommendation {
  id: string;
  type: string;
  title: string;
  insight: string;
  trafficAtRisk: number;
  estimatedGain: string;
  priority: string;
}

interface PageState {
  status?: string;
}

export interface PageEditRowProps {
  page: PageMeta;
  edit: EditState | undefined;
  expanded: boolean;
  isSaving: boolean;
  isSaved: boolean;
  isAiLoading: string | undefined;
  isDraftSaving?: boolean;
  isDraftSaved?: boolean;
  isSelected: boolean;
  pageRecs: Recommendation[];
  pageState: PageState | undefined;
  variations: { field: string; options: string[]; descOptions?: string[] } | undefined;
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
    <div id={`seo-editor-page-${page.id}`} className={`bg-zinc-900 rounded-xl border overflow-hidden ${trackingBorder || (hasRecFlag ? 'border-amber-500/30' : isSelected ? 'border-teal-500/40 bg-teal-500/5' : 'border-zinc-800')}`}>
      <div className="flex items-center">
        {showApprovalCheckbox && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleApprovalSelect(page.id); }}
            className="pl-4 pr-1 py-3 text-zinc-500 hover:text-teal-400 transition-colors"
          >
            {isSelected ? <CheckSquare className="w-4 h-4 text-teal-400" /> : <Square className="w-4 h-4" />}
          </button>
        )}
      <button
        onClick={() => onToggleExpand(page.id)}
        className="flex-1 flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/50 transition-colors text-left"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-zinc-200 truncate">{page.title}</div>
          <div className="text-xs text-zinc-500 truncate">/{page.slug}</div>
          {(primaryKeyword || (secondaryKeywords?.length ?? 0) > 0) && (
            <div className="flex items-center gap-1 flex-wrap mt-0.5">
              {primaryKeyword && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-400 font-medium" title={primaryKeyword}>
                  {primaryKeyword}
                </span>
              )}
              {secondaryKeywords?.slice(0, 3).map(kw => (
                <span key={kw} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60 border border-zinc-700 text-zinc-400" title={kw}>
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
              className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Clear page tracking status"
            >
              <X className="w-3 h-3" /> clear
            </button>
          )}
          {hasRecFlag && (
            <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              {metaRecs.length === 1 ? metaRecs[0].title.length > 20 ? `${metaRecs[0].title.slice(0, 20)}...` : metaRecs[0].title : `${metaRecs.length} issues`}
            </span>
          )}
          {!hasSeoTitle && !hasRecFlag && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">Missing title</span>}
          {!hasSeoDesc && !hasRecFlag && <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">Missing meta</span>}
          {edit?.dirty && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400">Unsaved</span>}
        </div>
      </button>
      <button
        onClick={() => onTogglePreview?.(page.id)}
        className="flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        title="Toggle preview"
      >
        👁️ Preview
      </button>
      </div>

      {expanded && edit && (
        <div className="px-4 pb-4 space-y-3 bg-zinc-900/30">
          {/* Recommendation banners */}
          {metaRecs.map(rec => (
            <div key={rec.id} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium text-amber-300">{rec.title}</div>
                  {rec.trafficAtRisk > 0 && (
                    <span className="text-[10px] text-amber-400/70">
                      {rec.trafficAtRisk.toLocaleString()} clicks at risk
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-zinc-400 mt-1">{rec.insight}</div>
                {rec.estimatedGain && (
                  <div className="text-[10px] text-green-400/70 mt-1">
                    Potential: {rec.estimatedGain}
                  </div>
                )}
              </div>
              <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                rec.priority === 'fix_now' ? 'bg-red-500/15 text-red-400' :
                rec.priority === 'fix_soon' ? 'bg-amber-500/15 text-amber-400' :
                'bg-zinc-500/15 text-zinc-400'
              }`}>
                {rec.priority === 'fix_now' ? 'Now' : rec.priority === 'fix_soon' ? 'Soon' : 'Later'}
              </span>
            </div>
          ))}
          {/* Error State */}
          {errorState && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-red-300">{errorState.type === 'network' ? 'Connection Error' : errorState.type === 'permission' ? 'Permission Error' : 'Error'}</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">{errorState.message}</div>
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
                  className="flex items-center gap-1 px-2 py-1 text-[11px] bg-purple-600/80 hover:bg-purple-500/80 text-white font-medium rounded transition-colors disabled:opacity-50"
                  title={hasAnalysis ? 'Re-analyze page (update recommendations)' : 'Run page analysis to generate optimization recommendations'}
                >
                  {isAnalyzing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Search className="w-2.5 h-2.5" />}
                  {hasAnalysis ? 'Re-analyze' : 'Analyze Page'}
                </button>
              )}
              {hasAnalysis && (
                <span className="text-[10px] text-green-400/70 flex items-center gap-1">
                  <Check className="w-2.5 h-2.5" /> Analysis on file
                </span>
              )}
            </div>
            <button
              onClick={() => onAiRewrite(page.id, 'both')}
              disabled={!!isAiLoading}
              className="flex items-center gap-1 px-2 py-1 text-[11px] bg-teal-600 hover:bg-teal-500 text-white font-medium rounded transition-colors disabled:opacity-50"
              title={hasAnalysis ? 'Generate paired title + description (using page analysis)' : 'Generate paired title + description'}
            >
              {isAiLoading === 'both' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
              AI Generate Both
            </button>
          </div>

          {/* Paired variation picker (when both were generated together) */}
          {variations?.field === 'both' && variations.options.length > 1 && variations.descOptions && (
            <div className="space-y-1.5 border border-teal-500/20 bg-teal-500/5 rounded-lg p-3">
              <div className="text-[11px] text-teal-400 font-medium">Pick a paired title + description:</div>
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
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs border transition-colors ${
                      isSelected
                        ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                        : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-300 hover:border-teal-500/30 hover:bg-teal-600/10'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-zinc-500 font-bold">{i + 1}.</span>
                      <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">Title</span>
                      <span className="flex-1">{titleV}</span>
                      <CharacterCounter current={titleV.length} max={60} size="sm" />
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-400">Desc</span>
                      <span className="flex-1 text-zinc-400">{descV}</span>
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
              <label className="text-xs font-medium text-zinc-400">SEO Title</label>
              <div className="flex items-center gap-1">
                <CharacterCounter current={edit.seoTitle.length} max={60} size="sm" />
                <button
                  onClick={() => onAiRewrite(page.id, 'title')}
                  disabled={!!isAiLoading}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] bg-teal-600/50 hover:bg-teal-500/50 rounded transition-colors disabled:opacity-50"
                  title="AI rewrite title only"
                >
                  {isAiLoading === 'title' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
                  AI
                </button>
              </div>
            </div>
            <input
              type="text"
              value={edit.seoTitle}
              onChange={e => onUpdateField(page.id, 'seoTitle', e.target.value)}
              placeholder="Enter SEO title..."
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm focus:outline-none focus:border-zinc-500"
            />
            {variations?.field === 'title' && variations.options.length > 1 && (
              <div className="mt-1.5 space-y-1">
                <div className="text-[11px] text-zinc-500 font-medium">Pick a variation:</div>
                {variations.options.map((v, i) => (
                  <button
                    key={i}
                    onClick={() => { onSelectVariation(page.id, 'seoTitle', v); onClearVariations(page.id); }}
                    className={`w-full text-left px-3 py-1.5 rounded text-xs border transition-colors ${
                      edit.seoTitle === v
                        ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                        : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-300 hover:border-teal-500/30 hover:bg-teal-600/10'
                    }`}
                  >
                    <span className="text-zinc-500 mr-1.5">{i + 1}.</span>{v}
                    <CharacterCounter current={v.length} max={60} size="sm" className="ml-2" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Meta Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-zinc-400">Meta Description</label>
              <div className="flex items-center gap-1">
                <CharacterCounter current={edit.seoDescription.length} max={160} size="sm" />
                <button
                  onClick={() => onAiRewrite(page.id, 'description')}
                  disabled={!!isAiLoading}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] bg-teal-600/50 hover:bg-teal-500/50 rounded transition-colors disabled:opacity-50"
                  title="AI rewrite description only"
                >
                  {isAiLoading === 'description' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
                  AI
                </button>
              </div>
            </div>
            <textarea
              value={edit.seoDescription}
              onChange={e => onUpdateField(page.id, 'seoDescription', e.target.value)}
              placeholder="Enter meta description..."
              rows={2}
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm focus:outline-none focus:border-zinc-500 resize-none"
            />
            {variations?.field === 'description' && variations.options.length > 1 && (
              <div className="mt-1.5 space-y-1">
                <div className="text-[11px] text-zinc-500 font-medium">Pick a variation:</div>
                {variations.options.map((v, i) => (
                  <button
                    key={i}
                    onClick={() => { onSelectVariation(page.id, 'seoDescription', v); onClearVariations(page.id); }}
                    className={`w-full text-left px-3 py-1.5 rounded text-xs border transition-colors ${
                      edit.seoDescription === v
                        ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
                        : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-300 hover:border-teal-500/30 hover:bg-teal-600/10'
                    }`}
                  >
                    <span className="text-zinc-500 mr-1.5">{i + 1}.</span>{v}
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isSentToClient ? 'bg-green-600 text-white' : 'bg-cyan-600/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-600/30 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {isSendingToClient ? <Loader2 className="w-3 h-3 animate-spin" /> : isSentToClient ? <Check className="w-3 h-3" /> : <Send className="w-3 h-3" />}
                {isSentToClient ? 'Sent!' : isSendingToClient ? 'Sending...' : 'Send to Client'}
              </button>
            )}
            {onSaveDraft && (
              <button
                onClick={() => onSaveDraft(page.id)}
                disabled={!edit.dirty || isDraftSaving}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isDraftSaved ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {isDraftSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : isDraftSaved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                {isDraftSaved ? 'Draft Saved!' : isDraftSaving ? 'Saving...' : 'Save Draft'}
              </button>
            )}
            <button
              onClick={() => onSave?.(page.id)}
              disabled={!edit.dirty || isSaving || !onSave}
              title={!onSave && isCmsPage ? 'CMS pages must be updated directly in Webflow' : undefined}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isSaved ? 'bg-green-600 text-white' : 'bg-white text-black hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : isSaved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
              {isSaved ? 'Saved!' : isSaving ? 'Saving...' : 'Save to Webflow'}
            </button>
          </div>
        </div>
      )}

      {/* Preview Section */}
      {showPreview && (
        <div className="border-t border-zinc-800 p-4 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-zinc-300">Preview</h4>
            <button
              onClick={() => onTogglePreview?.(page.id)}
              className="text-zinc-500 hover:text-zinc-300 text-xs"
            >
              Hide
            </button>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Google Search Preview */}
            <div>
              <div className="text-xs font-medium text-zinc-400 mb-2">Google Search</div>
              <SerpPreview
                title={edit?.seoTitle || page.title}
                description={edit?.seoDescription || ''}
                url={`/${page.slug}`}
                siteName="Your Site"
                size="sm"
              />
            </div>
            
            {/* Social Media Preview */}
            <div>
              <div className="text-xs font-medium text-zinc-400 mb-2">Facebook</div>
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
    </div>
  );
}
