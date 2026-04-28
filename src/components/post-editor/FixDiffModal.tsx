import { useEffect } from 'react';
import { X, Loader2, Check } from 'lucide-react';
import type { AiFixResult } from '../../../shared/types/content';

interface FixDiffModalProps {
  issueLabel: string;
  result: AiFixResult | null;
  loading: boolean;
  applying: boolean;
  onApply: (result: AiFixResult) => void;
  onDismiss: () => void;
}

export function FixDiffModal({ issueLabel, result, loading, applying, onApply, onDismiss }: FixDiffModalProps) {
  if (!loading && !result) return null;

  const parsedMeta = result?.field === 'meta'
    ? (() => { try { return JSON.parse(result.suggestedText) as { seoTitle: string; seoMetaDescription: string }; } catch { return null; } })()
    : null;

  const parsedMetaOriginal = result?.field === 'meta'
    ? (() => { try { return JSON.parse(result.originalText) as { seoTitle: string; seoMetaDescription: string }; } catch { return null; } })()
    : null;

  useEffect(() => {
    if (!loading && !result) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [loading, result, onDismiss]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-[var(--brand-overlay)]"
      onClick={onDismiss}
    >
      <div
        className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] w-full max-w-2xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--brand-border)]/50">
          <span className="text-sm font-semibold text-[var(--brand-text-bright)]">
            AI Fix: {issueLabel}
          </span>
          <button
            onClick={onDismiss}
            className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[var(--brand-text-muted)]">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Generating fix…</span>
            </div>
          ) : result ? (
            <div className="space-y-4">
              {result.field === 'meta' && parsedMeta && parsedMetaOriginal ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Current SEO Title</div>
                    <div className="p-2 rounded bg-red-500/5 border border-red-500/20 text-xs text-red-300/80 line-through">
                      {parsedMetaOriginal.seoTitle}
                    </div>
                  </div>
                  <div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Suggested SEO Title</div>
                    <div className="p-2 rounded bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-300/80">
                      {parsedMeta.seoTitle}
                    </div>
                  </div>
                  <div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Current Meta Description</div>
                    <div className="p-2 rounded bg-red-500/5 border border-red-500/20 text-xs text-red-300/80 line-through">
                      {parsedMetaOriginal.seoMetaDescription}
                    </div>
                  </div>
                  <div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Suggested Meta Description</div>
                    <div className="p-2 rounded bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-300/80">
                      {parsedMeta.seoMetaDescription}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Original</div>
                    {/* Admin-only: AI-generated HTML from trusted endpoint — same pattern as PostEditor/PostPreview */}
                    <div
                      className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-[var(--brand-text)] leading-relaxed line-through decoration-red-500/40 [&_strong]:text-[var(--brand-text-bright)] [&_h2]:font-semibold [&_h2]:text-[var(--brand-text-bright)] [&_a]:text-teal-400 max-h-56 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: result.originalText }}
                    />
                  </div>
                  <div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Suggested</div>
                    <div
                      className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs text-[var(--brand-text)] leading-relaxed [&_strong]:text-[var(--brand-text-bright)] [&_h2]:font-semibold [&_h2]:text-[var(--brand-text-bright)] [&_a]:text-teal-400 max-h-56 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: result.suggestedText }}
                    />
                  </div>
                </div>
              )}

              {result.explanation && (
                <p className="t-caption text-[var(--brand-text-muted)] border-t border-[var(--brand-border)]/50 pt-3">
                  {result.explanation}
                </p>
              )}

              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={onDismiss}
                  className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] border border-[var(--brand-border)] hover:border-[var(--brand-border-hover)] transition-colors"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => onApply(result)}
                  disabled={applying}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50"
                >
                  {applying
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Applying…</>
                    : <><Check className="w-3 h-3" /> Apply</>}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
