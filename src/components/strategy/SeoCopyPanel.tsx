import {
  Loader2, RefreshCw, Wand2, Check, Copy, Link, MessageSquare,
} from 'lucide-react';

interface SeoCopy {
  seoTitle: string;
  metaDescription: string;
  h1: string;
  introParagraph: string;
  internalLinkSuggestions?: { targetPath: string; anchorText: string; context: string }[];
  changes?: string[];
}

interface PageKeywordMap {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent?: string;
  currentPosition?: number;
  impressions?: number;
  clicks?: number;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

interface SeoCopyPanelProps {
  page: PageKeywordMap;
  seoCopyResults: Map<string, SeoCopy>;
  generatingCopy: string | null;
  copiedField: string | null;
  onGenerateSeoCopy: (page: PageKeywordMap) => void;
  onCopyText: (text: string, label: string) => void;
}

export function SeoCopyPanel({
  page, seoCopyResults, generatingCopy, copiedField,
  onGenerateSeoCopy, onCopyText,
}: SeoCopyPanelProps) {
  return (
    <div className="mt-3 pt-2 border-t border-zinc-800">
      {!seoCopyResults.has(page.pagePath) ? (
        <button
          onClick={(e) => { e.stopPropagation(); onGenerateSeoCopy(page); }}
          disabled={generatingCopy === page.pagePath}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600/20 border border-teal-500/30 hover:bg-teal-600/30 disabled:opacity-50 text-teal-300 text-[11px] font-medium transition-colors"
        >
          {generatingCopy === page.pagePath ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Generating SEO Copy...</>
          ) : (
            <><Wand2 className="w-3 h-3" /> Generate SEO Copy</>
          )}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="text-[11px] font-semibold text-teal-300 uppercase tracking-wider flex items-center gap-1">
              <Wand2 className="w-3 h-3" /> Generated SEO Copy
            </h5>
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateSeoCopy(page); }}
              disabled={generatingCopy === page.pagePath}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-teal-400 transition-colors"
            >
              {generatingCopy === page.pagePath ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />} Regenerate
            </button>
          </div>
          {(() => {
            const copy = seoCopyResults.get(page.pagePath)!;
            return (
              <div className="space-y-2">
                {/* SEO Title */}
                <div className="bg-zinc-800/60 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">SEO Title</span>
                    <button onClick={(e) => { e.stopPropagation(); onCopyText(copy.seoTitle, 'seoTitle'); }} className="flex items-center gap-0.5 text-[11px] text-zinc-500 hover:text-teal-400">
                      {copiedField === 'seoTitle' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                      {copiedField === 'seoTitle' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-200">{copy.seoTitle}</p>
                  <span className="text-[11px] text-zinc-500 mt-0.5 block">{copy.seoTitle.length} chars</span>
                </div>
                {/* Meta Description */}
                <div className="bg-zinc-800/60 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Meta Description</span>
                    <button onClick={(e) => { e.stopPropagation(); onCopyText(copy.metaDescription, 'metaDesc'); }} className="flex items-center gap-0.5 text-[11px] text-zinc-500 hover:text-teal-400">
                      {copiedField === 'metaDesc' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                      {copiedField === 'metaDesc' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-300">{copy.metaDescription}</p>
                  <span className="text-[11px] text-zinc-500 mt-0.5 block">{copy.metaDescription.length} chars</span>
                </div>
                {/* H1 */}
                <div className="bg-zinc-800/60 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Suggested H1</span>
                    <button onClick={(e) => { e.stopPropagation(); onCopyText(copy.h1, 'h1'); }} className="flex items-center gap-0.5 text-[11px] text-zinc-500 hover:text-teal-400">
                      {copiedField === 'h1' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                      {copiedField === 'h1' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-200 font-medium">{copy.h1}</p>
                </div>
                {/* Intro Paragraph */}
                <div className="bg-zinc-800/60 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Intro Paragraph</span>
                    <button onClick={(e) => { e.stopPropagation(); onCopyText(copy.introParagraph, 'intro'); }} className="flex items-center gap-0.5 text-[11px] text-zinc-500 hover:text-teal-400">
                      {copiedField === 'intro' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                      {copiedField === 'intro' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed">{copy.introParagraph}</p>
                </div>
                {/* Internal Link Suggestions */}
                {copy.internalLinkSuggestions && copy.internalLinkSuggestions.length > 0 && (
                  <div className="bg-zinc-800/60 rounded-lg p-2.5">
                    <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-1 mb-1.5">
                      <Link className="w-2.5 h-2.5" /> Internal Link Suggestions
                    </span>
                    <div className="space-y-1">
                      {copy.internalLinkSuggestions.map((link, li) => (
                        <div key={li} className="flex items-start gap-2 text-[11px]">
                          <span className="text-teal-400 font-mono shrink-0">{link.targetPath}</span>
                          <span className="text-zinc-400">"{link.anchorText}"</span>
                          <span className="text-zinc-500 italic">{link.context}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Changes Rationale */}
                {copy.changes && copy.changes.length > 0 && (
                  <div className="bg-zinc-800/40 rounded-lg p-2.5">
                    <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-1 mb-1.5">
                      <MessageSquare className="w-2.5 h-2.5" /> Why These Changes
                    </span>
                    <ul className="space-y-0.5">
                      {copy.changes.map((c, ci) => (
                        <li key={ci} className="text-[11px] text-zinc-400 flex items-start gap-1">
                          <span className="text-teal-400 mt-0.5">•</span> {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
