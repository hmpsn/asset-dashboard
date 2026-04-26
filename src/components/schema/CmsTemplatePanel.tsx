import {
  Loader2, Copy, CheckCircle, Upload,
} from 'lucide-react';
import { Icon, Button } from '../ui';

interface CmsTemplatePage {
  pageId: string;
  pageTitle: string;
  slug: string;
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
}

interface CmsTemplateResult {
  templateString: string;
  schemaTypes: string[];
  fieldsUsed: string[];
  collectionName: string;
  collectionSlug: string;
}

interface CmsTemplatePanelProps {
  showCmsPanel: boolean;
  cmsTemplatePages: CmsTemplatePage[];
  generatingCmsTemplate: string | null;
  cmsTemplateResult: CmsTemplateResult | null;
  publishingCmsTemplate: boolean;
  cmsPublished: boolean;
  cmsCopied: boolean;
  cmsError: string | null;
  onClose: () => void;
  onGenerateCmsTemplate: (page: CmsTemplatePage) => void;
  onCopyCmsTemplate: () => void;
  onPublishCmsTemplate: () => void;
}

export function CmsTemplatePanel({
  showCmsPanel, cmsTemplatePages, generatingCmsTemplate,
  cmsTemplateResult, publishingCmsTemplate, cmsPublished,
  cmsCopied, cmsError,
  onClose, onGenerateCmsTemplate, onCopyCmsTemplate, onPublishCmsTemplate,
}: CmsTemplatePanelProps) {
  return (
    <>
      {/* CMS Template Panel */}
      {showCmsPanel && (
        <div className="w-full max-w-lg bg-[var(--surface-2)] border border-amber-500/20 overflow-hidden mt-2" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <div className="px-4 py-2.5 border-b border-[var(--brand-border)] flex items-center justify-between">
            <span className="t-caption font-medium text-amber-300">CMS Collection Templates</span>
            <button onClick={onClose} className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]">Close</button>
          </div>
          {cmsTemplatePages.length === 0 ? (
            <div className="px-4 py-6 t-caption text-[var(--brand-text-muted)] text-center">No CMS collections found</div>
          ) : (
            <div className="max-h-[200px] overflow-y-auto">
              {cmsTemplatePages.map(p => (
                <button
                  key={p.collectionId}
                  onClick={() => onGenerateCmsTemplate(p)}
                  disabled={generatingCmsTemplate === p.collectionId}
                  className="w-full text-left px-4 py-2.5 hover:bg-[var(--surface-3)]/50 transition-colors border-b border-[var(--brand-border)]/30 last:border-b-0 disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <span className="t-caption text-[var(--brand-text)]">{p.collectionName}</span>
                    {generatingCmsTemplate === p.collectionId && <Icon as={Loader2} size="sm" className="animate-spin text-amber-400/80" />}
                  </div>
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">/{p.collectionSlug}/{'{'} slug {'}'} · Template: {p.pageTitle}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CMS Template Result */}
      {cmsTemplateResult && (
        <div className="w-full max-w-2xl bg-[var(--surface-2)] border border-amber-500/20 overflow-hidden mt-2" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <div className="px-4 py-2.5 border-b border-[var(--brand-border)]">
            <div className="flex items-center justify-between">
              <div>
                <span className="t-caption font-medium text-amber-300">Template: {cmsTemplateResult.collectionName}</span>
                <div className="flex gap-1.5 mt-1">
                  {cmsTemplateResult.schemaTypes.map((t, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded t-caption-sm font-mono bg-amber-500/8 text-amber-300 border border-amber-500/20">{t}</span>
                  ))}
                </div>
              </div>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">{cmsTemplateResult.fieldsUsed.length} CMS fields used</span>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="relative">
              <pre className="t-caption font-mono bg-[var(--surface-1)] rounded-[var(--radius-md)] p-3 overflow-x-auto text-[var(--brand-text-muted)] border border-[var(--brand-border)] max-h-64 overflow-y-auto whitespace-pre-wrap">
                {cmsTemplateResult.templateString}
              </pre>
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                <button
                  onClick={onCopyCmsTemplate}
                  className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                >
                  {cmsCopied ? <><Icon as={CheckCircle} size="sm" className="text-emerald-400/80" /> Copied</> : <><Icon as={Copy} size="sm" /> Copy</>}
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              {cmsPublished ? (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
                  <Icon as={CheckCircle} size="sm" /> Published to Webflow
                </span>
              ) : (
                <Button
                  onClick={onPublishCmsTemplate}
                  disabled={publishingCmsTemplate}
                  variant="primary"
                  size="sm"
                  icon={publishingCmsTemplate ? Loader2 : Upload}
                  loading={publishingCmsTemplate}
                  className="bg-gradient-to-r from-amber-600/80 to-orange-600/80 hover:from-amber-500 hover:to-orange-500"
                >
                  {publishingCmsTemplate ? 'Publishing...' : 'Publish to Template Page'}
                </Button>
              )}
              {cmsError && <span className="t-caption text-red-400/80">{cmsError}</span>}
            </div>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-2">This template uses {'{{wf}}'} tags — each CMS item page gets unique schema with its own field values.</p>
          </div>
        </div>
      )}

      {/* Loading states */}
      {generatingCmsTemplate && !cmsTemplateResult && (
        <div className="flex items-center gap-2 text-amber-400/70 text-sm mt-2">
          <Icon as={Loader2} size="md" className="animate-spin" /> Generating CMS template schema...
        </div>
      )}
    </>
  );
}
