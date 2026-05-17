import {
  Sparkles, ChevronDown, ChevronUp, ExternalLink,
} from 'lucide-react';
import { AIContextIndicator, Icon, Button, FormInput, FormSelect, FormTextarea } from '../ui';
import type { BriefTemplateCrossrefMatch } from '../../../shared/types/content';

export interface BriefGeneratorProps {
  workspaceId: string;
  keyword: string;
  businessCtx: string;
  pageType: string;
  refUrls: string;
  showAdvanced: boolean;
  generating: boolean;
  error: string;
  templateCrossref?: BriefTemplateCrossrefMatch | null;
  onKeywordChange: (value: string) => void;
  onBusinessCtxChange: (value: string) => void;
  onPageTypeChange: (value: string) => void;
  onRefUrlsChange: (value: string) => void;
  onToggleAdvanced: () => void;
  onGenerate: () => void;
}

export function BriefGenerator({
  workspaceId,
  keyword,
  businessCtx,
  pageType,
  refUrls,
  showAdvanced,
  generating,
  error,
  templateCrossref,
  onKeywordChange,
  onBusinessCtxChange,
  onPageTypeChange,
  onRefUrlsChange,
  onToggleAdvanced,
  onGenerate,
}: BriefGeneratorProps) {
  return (
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-5 space-y-3" style={{ borderRadius: 'var(--radius-signature)' }}>
      <div className="flex items-center gap-2 mb-1">
        <Icon as={Sparkles} size="md" className="text-amber-400" />
        <span className="text-xs font-medium text-[var(--brand-text-bright)]">Generate AI Content Brief</span>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-2">
          <div>
            <label className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Target Keyword *</label>
            <FormInput
              type="text"
              value={keyword}
              onChange={onKeywordChange}
              placeholder="e.g. dental implants near me"
              className="w-full"
              onKeyDown={e => e.key === 'Enter' && !generating && onGenerate()}
            />
          </div>
          <div>
            <label className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Page Type</label>
            <FormSelect
              value={pageType}
              onChange={onPageTypeChange}
              options={[
                { value: '', label: 'Auto-detect' },
                { value: 'blog', label: 'Blog Post' },
                { value: 'landing', label: 'Landing Page' },
                { value: 'service', label: 'Service Page' },
                { value: 'location', label: 'Location Page' },
                { value: 'product', label: 'Product Page' },
                { value: 'pillar', label: 'Pillar Page' },
                { value: 'resource', label: 'Resource / Guide' },
              ]}
              className="w-full cursor-pointer"
            />
          </div>
        </div>
        {templateCrossref && (
          <div className="rounded-[var(--radius-lg)] border border-blue-500/25 bg-blue-500/10 px-3 py-2.5">
            <p className="t-caption-sm text-blue-300 font-medium">
              Matched Template: {templateCrossref.templateName}
            </p>
            <p className="t-caption-sm text-blue-200/90 mt-0.5">
              Matrix: {templateCrossref.matrixName} · {templateCrossref.sections.length} template sections will pre-fill this brief.
            </p>
          </div>
        )}
        <div>
          <label className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Business Context (optional)</label>
          <FormInput
            type="text"
            value={businessCtx}
            onChange={onBusinessCtxChange}
            placeholder="e.g. Local dental practice in Austin, TX specializing in cosmetic dentistry"
            className="w-full"
          />
        </div>
      </div>

      {/* Advanced Options */}
      <Button
        onClick={onToggleAdvanced}
        icon={showAdvanced ? ChevronUp : ChevronDown}
        size="sm"
        variant="ghost"
        className="h-auto px-0 py-0 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-transparent"
      >
        Advanced Options
      </Button>
      {showAdvanced && (
        <div className="space-y-2 pl-1 border-l-2 border-[var(--brand-border)] ml-1">
          <div>
            <label className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">
              <Icon as={ExternalLink} size="sm" className="mr-1" />
              Reference URLs (competitor/inspiration pages — one per line)
            </label>
            <FormTextarea
              value={refUrls}
              onChange={onRefUrlsChange}
              placeholder={"https://competitor.com/their-great-article\nhttps://example.com/inspiring-content"}
              rows={3}
              className="w-full"
            />
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">We&apos;ll scrape these pages and use their structure/tone as context (up to 5 URLs)</p>
          </div>
        </div>
      )}

      <AIContextIndicator workspaceId={workspaceId} feature="briefs" />

      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <Button
          onClick={onGenerate}
          disabled={!keyword.trim() || generating}
          loading={generating}
          icon={Sparkles}
          size="md"
          variant="secondary"
          className="rounded-[var(--radius-lg)] text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white border-0"
        >
          {generating ? 'Generating...' : 'Generate Brief'}
        </Button>
        {generating && (
          <span className="t-caption-sm text-[var(--brand-text-muted)] animate-pulse">Enriching with SERP data, GA4 insights, and knowledge base...</span>
        )}
      </div>
    </div>
  );
}
