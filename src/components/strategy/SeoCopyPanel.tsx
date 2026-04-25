import { Icon } from '../ui';
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
    <div className="mt-3 pt-2 border-t border-[var(--brand-border)]">
      {!seoCopyResults.has(page.pagePath) ? (
        <button
          onClick={(e) => { e.stopPropagation(); onGenerateSeoCopy(page); }}
          disabled={generatingCopy === page.pagePath}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 hover:bg-teal-600/30 disabled:opacity-50 text-teal-300 t-caption-sm font-medium transition-colors"
        >
          {generatingCopy === page.pagePath ? (
            <><Icon as={Loader2} size="sm" className="animate-spin" /> Generating SEO Copy...</>
          ) : (
            <><Icon as={Wand2} size="sm" className="text-teal-300" /> Generate SEO Copy</>
          )}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="t-caption-sm font-semibold text-teal-300 uppercase tracking-wider flex items-center gap-1">
              <Icon as={Wand2} size="sm" className="text-teal-300" /> Generated SEO Copy
            </h5>
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateSeoCopy(page); }}
              disabled={generatingCopy === page.pagePath}
              className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-400 transition-colors"
            >
              {generatingCopy === page.pagePath ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={RefreshCw} size="sm" />} Regenerate
            </button>
          </div>
          {(() => {
            const copy = seoCopyResults.get(page.pagePath)!;
            return (
              <div className="space-y-2">
                {/* SEO Title */}
                <div className="bg-[var(--surface-3)]/60 rounded-[var(--radius-lg)] p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">SEO Title</span>
                    <button onClick={(e) => { e.stopPropagation(); onCopyText(copy.seoTitle, 'seoTitle'); }} className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-400">
                      {copiedField === 'seoTitle' ? <Icon as={Check} size="sm" className="text-emerald-400" /> : <Icon as={Copy} size="sm" />}
                      {copiedField === 'seoTitle' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="t-caption text-[var(--brand-text-bright)]">{copy.seoTitle}</p>
                  <span className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 block">{copy.seoTitle.length} chars</span>
                </div>
                {/* Meta Description */}
                <div className="bg-[var(--surface-3)]/60 rounded-[var(--radius-lg)] p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">Meta Description</span>
                    <button onClick={(e) => { e.stopPropagation(); onCopyText(copy.metaDescription, 'metaDesc'); }} className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-400">
                      {copiedField === 'metaDesc' ? <Icon as={Check} size="sm" className="text-emerald-400" /> : <Icon as={Copy} size="sm" />}
                      {copiedField === 'metaDesc' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="t-caption text-[var(--brand-text-bright)]">{copy.metaDescription}</p>
                  <span className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 block">{copy.metaDescription.length} chars</span>
                </div>
                {/* H1 */}
                <div className="bg-[var(--surface-3)]/60 rounded-[var(--radius-lg)] p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">Suggested H1</span>
                    <button onClick={(e) => { e.stopPropagation(); onCopyText(copy.h1, 'h1'); }} className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-400">
                      {copiedField === 'h1' ? <Icon as={Check} size="sm" className="text-emerald-400" /> : <Icon as={Copy} size="sm" />}
                      {copiedField === 'h1' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="t-caption font-medium text-[var(--brand-text-bright)]">{copy.h1}</p>
                </div>
                {/* Intro Paragraph */}
                <div className="bg-[var(--surface-3)]/60 rounded-[var(--radius-lg)] p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">Intro Paragraph</span>
                    <button onClick={(e) => { e.stopPropagation(); onCopyText(copy.introParagraph, 'intro'); }} className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-400">
                      {copiedField === 'intro' ? <Icon as={Check} size="sm" className="text-emerald-400" /> : <Icon as={Copy} size="sm" />}
                      {copiedField === 'intro' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="t-caption text-[var(--brand-text-bright)] leading-relaxed">{copy.introParagraph}</p>
                </div>
                {/* Internal Link Suggestions */}
                {copy.internalLinkSuggestions && copy.internalLinkSuggestions.length > 0 && (
                  <div className="bg-[var(--surface-3)]/60 rounded-[var(--radius-lg)] p-2.5">
                    <span className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider flex items-center gap-1 mb-1.5">
                      <Icon as={Link} size="sm" /> Internal Link Suggestions
                    </span>
                    <div className="space-y-1">
                      {copy.internalLinkSuggestions.map((link, li) => (
                        <div key={li} className="flex items-start gap-2 t-caption-sm">
                          <span className="text-teal-400 font-mono shrink-0">{link.targetPath}</span>
                          <span className="text-[var(--brand-text)]">"{link.anchorText}"</span>
                          <span className="text-[var(--brand-text-muted)] italic">{link.context}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Changes Rationale */}
                {copy.changes && copy.changes.length > 0 && (
                  <div className="bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] p-2.5">
                    <span className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider flex items-center gap-1 mb-1.5">
                      <Icon as={MessageSquare} size="sm" /> Why These Changes
                    </span>
                    <ul className="space-y-0.5">
                      {copy.changes.map((c, ci) => (
                        <li key={ci} className="t-caption-sm text-[var(--brand-text)] flex items-start gap-1">
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
