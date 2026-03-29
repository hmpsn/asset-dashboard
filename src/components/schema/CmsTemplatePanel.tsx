import {
  Loader2, Copy, CheckCircle, Upload, Database,
} from 'lucide-react';

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
        <div className="w-full max-w-lg bg-zinc-900 border border-amber-500/20 rounded-xl overflow-hidden mt-2">
          <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-xs font-medium text-amber-300">CMS Collection Templates</span>
            <button onClick={onClose} className="text-[11px] text-zinc-500 hover:text-zinc-400">Close</button>
          </div>
          {cmsTemplatePages.length === 0 ? (
            <div className="px-4 py-6 text-xs text-zinc-500 text-center">No CMS collections found</div>
          ) : (
            <div className="max-h-[200px] overflow-y-auto">
              {cmsTemplatePages.map(p => (
                <button
                  key={p.collectionId}
                  onClick={() => onGenerateCmsTemplate(p)}
                  disabled={generatingCmsTemplate === p.collectionId}
                  className="w-full text-left px-4 py-2.5 hover:bg-zinc-800/50 transition-colors border-b border-zinc-800/30 last:border-b-0 disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-300">{p.collectionName}</span>
                    {generatingCmsTemplate === p.collectionId && <Loader2 className="w-3 h-3 animate-spin text-amber-400/80" />}
                  </div>
                  <span className="text-[11px] text-zinc-500">/{p.collectionSlug}/{'{'} slug {'}'} · Template: {p.pageTitle}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CMS Template Result */}
      {cmsTemplateResult && (
        <div className="w-full max-w-2xl bg-zinc-900 border border-amber-500/20 rounded-xl overflow-hidden mt-2">
          <div className="px-4 py-2.5 border-b border-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-amber-300">Template: {cmsTemplateResult.collectionName}</span>
                <div className="flex gap-1.5 mt-1">
                  {cmsTemplateResult.schemaTypes.map((t, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-amber-500/8 text-amber-300 border border-amber-500/20">{t}</span>
                  ))}
                </div>
              </div>
              <span className="text-[11px] text-zinc-500">{cmsTemplateResult.fieldsUsed.length} CMS fields used</span>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="relative">
              <pre className="text-xs font-mono bg-zinc-950 rounded-lg p-3 overflow-x-auto text-zinc-400 border border-zinc-800 max-h-64 overflow-y-auto whitespace-pre-wrap">
                {cmsTemplateResult.templateString}
              </pre>
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                <button
                  onClick={onCopyCmsTemplate}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {cmsCopied ? <><CheckCircle className="w-3 h-3 text-emerald-400/80" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              {cmsPublished ? (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
                  <CheckCircle className="w-3.5 h-3.5" /> Published to Webflow
                </span>
              ) : (
                <button
                  onClick={onPublishCmsTemplate}
                  disabled={publishingCmsTemplate}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 bg-gradient-to-r from-amber-600/80 to-orange-600/80 hover:from-amber-500 hover:to-orange-500 text-white"
                >
                  {publishingCmsTemplate ? <><Loader2 className="w-3 h-3 animate-spin" /> Publishing...</> : <><Upload className="w-3.5 h-3.5" /> Publish to Template Page</>}
                </button>
              )}
              {cmsError && <span className="text-xs text-red-400/80">{cmsError}</span>}
            </div>
            <p className="text-[11px] text-zinc-500 mt-2">This template uses {'{{wf}}'} tags — each CMS item page gets unique schema with its own field values.</p>
          </div>
        </div>
      )}

      {/* Loading states */}
      {generatingCmsTemplate && !cmsTemplateResult && (
        <div className="flex items-center gap-2 text-amber-400/70 text-sm mt-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Generating CMS template schema...
        </div>
      )}
    </>
  );
}
