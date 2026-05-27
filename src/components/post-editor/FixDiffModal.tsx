import { Loader2, Check } from 'lucide-react';
import type { AiFixResult } from '../../../shared/types/content';
import { Button } from '../ui';
import { Modal } from '../ui/overlay/Modal';
import { diffRichTextClass } from './richTextStyles';

interface FixDiffModalProps {
  issueLabel: string;
  result: AiFixResult | null;
  loading: boolean;
  applying: boolean;
  onApply: (result: AiFixResult) => void;
  onDismiss: () => void;
}

function tryParseMeta(s: string): { seoTitle: string; seoMetaDescription: string } | null {
  try { return JSON.parse(s) as { seoTitle: string; seoMetaDescription: string }; }
  catch { return null; }
}

interface PostFixPayload {
  introduction: string;
  sections: Array<{ index: number; content: string }>;
  conclusion: string;
}

function tryParsePostPayload(s: string): PostFixPayload | null {
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<PostFixPayload>;
    if (typeof candidate.introduction !== 'string') return null;
    if (!Array.isArray(candidate.sections)) return null;
    if (typeof candidate.conclusion !== 'string') return null;
    const validSections = candidate.sections.every(section =>
      section
      && typeof section === 'object'
      && typeof section.index === 'number'
      && Number.isInteger(section.index)
      && typeof section.content === 'string');
    if (!validSections) return null;
    return {
      introduction: candidate.introduction,
      sections: candidate.sections as Array<{ index: number; content: string }>,
      conclusion: candidate.conclusion,
    };
  } catch {
    return null;
  }
}

export function FixDiffModal({ issueLabel, result, loading, applying, onApply, onDismiss }: FixDiffModalProps) {
  const open = loading || result !== null;

  const parsedMeta = result?.field === 'meta' ? tryParseMeta(result.suggestedText) : null;
  const parsedMetaOriginal = result?.field === 'meta' ? tryParseMeta(result.originalText) : null;
  const parsedPost = result?.field === 'post' ? tryParsePostPayload(result.suggestedText) : null;
  const parsedPostOriginal = result?.field === 'post' ? tryParsePostPayload(result.originalText) : null;

  return (
    <Modal open={open} onClose={onDismiss} size="lg">
      <Modal.Header title={`AI Fix: ${issueLabel}`} onClose={onDismiss} />
      <Modal.Body>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[var(--brand-text-muted)]">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Generating fix…</span>
          </div>
        ) : result ? (
          <div className="space-y-4">
            {result.field === 'meta' && parsedMeta && parsedMetaOriginal ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Current SEO Title</div>
                  <div className="p-2 rounded-[var(--radius-md)] bg-red-500/5 border border-red-500/20 text-xs text-red-300/80 line-through">
                    {parsedMetaOriginal.seoTitle}
                  </div>
                </div>
                <div>
                  <div className="t-caption-sm text-teal-300 mb-1">Suggested SEO Title</div>
                  <div className="p-2 rounded-[var(--radius-md)] bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-300/80">
                    {parsedMeta.seoTitle}
                  </div>
                </div>
                <div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Current Meta Description</div>
                  <div className="p-2 rounded-[var(--radius-md)] bg-red-500/5 border border-red-500/20 text-xs text-red-300/80 line-through">
                    {parsedMetaOriginal.seoMetaDescription}
                  </div>
                </div>
                <div>
                  <div className="t-caption-sm text-teal-300 mb-1">Suggested Meta Description</div>
                  <div className="p-2 rounded-[var(--radius-md)] bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-300/80">
                    {parsedMeta.seoMetaDescription}
                  </div>
                </div>
              </div>
            ) : result.field === 'post' && parsedPost && parsedPostOriginal ? (
              <div className="space-y-3">
                <div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Introduction</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div
                      className={`p-3 rounded-[var(--radius-lg)] bg-red-500/5 border border-red-500/20 line-through decoration-red-500/40 max-h-40 overflow-y-auto ${diffRichTextClass}`}
                      dangerouslySetInnerHTML={{ __html: parsedPostOriginal.introduction }}
                    />
                    <div
                      className={`p-3 rounded-[var(--radius-lg)] bg-emerald-500/5 border border-emerald-500/20 max-h-40 overflow-y-auto ${diffRichTextClass}`}
                      dangerouslySetInnerHTML={{ __html: parsedPost.introduction }}
                    />
                  </div>
                </div>
                <div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Sections</div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {parsedPost.sections.map((section) => {
                      const originalSection = parsedPostOriginal.sections.find(item => item.index === section.index);
                      return (
                        <div key={section.index} className="rounded-[var(--radius-md)] border border-[var(--brand-border)]/60 p-2">
                          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Section {section.index + 1}</div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div
                              className={`p-2 rounded-[var(--radius-md)] bg-red-500/5 border border-red-500/20 line-through decoration-red-500/40 max-h-32 overflow-y-auto ${diffRichTextClass}`}
                              dangerouslySetInnerHTML={{ __html: originalSection?.content ?? '' }}
                            />
                            <div
                              className={`p-2 rounded-[var(--radius-md)] bg-emerald-500/5 border border-emerald-500/20 max-h-32 overflow-y-auto ${diffRichTextClass}`}
                              dangerouslySetInnerHTML={{ __html: section.content }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Conclusion</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div
                      className={`p-3 rounded-[var(--radius-lg)] bg-red-500/5 border border-red-500/20 line-through decoration-red-500/40 max-h-40 overflow-y-auto ${diffRichTextClass}`}
                      dangerouslySetInnerHTML={{ __html: parsedPostOriginal.conclusion }}
                    />
                    <div
                      className={`p-3 rounded-[var(--radius-lg)] bg-emerald-500/5 border border-emerald-500/20 max-h-40 overflow-y-auto ${diffRichTextClass}`}
                      dangerouslySetInnerHTML={{ __html: parsedPost.conclusion }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Original</div>
                  {/* AI HTML output is sanitized server-side via sanitizeRichText() in /ai-fix endpoint */}
                  <div
                    className={`p-3 rounded-[var(--radius-lg)] bg-red-500/5 border border-red-500/20 line-through decoration-red-500/40 max-h-56 overflow-y-auto ${diffRichTextClass}`}
                    dangerouslySetInnerHTML={{ __html: result.originalText }}
                  />
                </div>
                <div>
                  <div className="t-caption-sm text-teal-300 mb-1">Suggested</div>
                  <div
                    className={`p-3 rounded-[var(--radius-lg)] bg-emerald-500/5 border border-emerald-500/20 max-h-56 overflow-y-auto ${diffRichTextClass}`}
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
          </div>
        ) : null}
      </Modal.Body>
      {result && !loading ? (
        <Modal.Footer>
          <Button
            onClick={onDismiss}
            variant="ghost"
            size="sm"
            className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] border border-[var(--brand-border)] hover:border-[var(--brand-border-hover)] transition-colors"
          >
            Dismiss
          </Button>
          <Button
            onClick={() => onApply(result)}
            disabled={applying}
            variant="ghost"
            size="sm"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50"
          >
            {applying
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Applying…</>
              : <><Check className="w-3 h-3" /> Apply</>}
          </Button>
        </Modal.Footer>
      ) : null}
    </Modal>
  );
}
