import {
  Loader2, Sparkles, ChevronDown, ChevronUp, ExternalLink,
} from 'lucide-react';
import { AIContextIndicator, Icon } from '../ui';

export interface BriefGeneratorProps {
  workspaceId: string;
  keyword: string;
  businessCtx: string;
  pageType: string;
  refUrls: string;
  showAdvanced: boolean;
  generating: boolean;
  error: string;
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
  onKeywordChange,
  onBusinessCtxChange,
  onPageTypeChange,
  onRefUrlsChange,
  onToggleAdvanced,
  onGenerate,
}: BriefGeneratorProps) {
  return (
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-5 space-y-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
      <div className="flex items-center gap-2 mb-1">
        <Icon as={Sparkles} size="md" className="text-amber-400" />
        <span className="text-xs font-medium text-[var(--brand-text-bright)]">Generate AI Content Brief</span>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-2">
          <div>
            <label className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Target Keyword *</label>
            <input
              type="text"
              value={keyword}
              onChange={e => onKeywordChange(e.target.value)}
              placeholder="e.g. dental implants near me"
              className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)]"
              onKeyDown={e => e.key === 'Enter' && !generating && onGenerate()}
            />
          </div>
          <div>
            <label className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Page Type</label>
            <select
              value={pageType}
              onChange={e => onPageTypeChange(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg text-xs text-[var(--brand-text-bright)] focus:outline-none cursor-pointer"
            >
              <option value="">Auto-detect</option>
              <option value="blog">Blog Post</option>
              <option value="landing">Landing Page</option>
              <option value="service">Service Page</option>
              <option value="location">Location Page</option>
              <option value="product">Product Page</option>
              <option value="pillar">Pillar Page</option>
              <option value="resource">Resource / Guide</option>
            </select>
          </div>
        </div>
        <div>
          <label className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">Business Context (optional)</label>
          <input
            type="text"
            value={businessCtx}
            onChange={e => onBusinessCtxChange(e.target.value)}
            placeholder="e.g. Local dental practice in Austin, TX specializing in cosmetic dentistry"
            className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)]"
          />
        </div>
      </div>

      {/* Advanced Options */}
      <button
        onClick={onToggleAdvanced}
        className="flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
      >
        <Icon as={showAdvanced ? ChevronUp : ChevronDown} size="sm" />
        Advanced Options
      </button>
      {showAdvanced && (
        <div className="space-y-2 pl-1 border-l-2 border-[var(--brand-border)] ml-1">
          <div>
            <label className="t-caption-sm text-[var(--brand-text-muted)] block mb-0.5">
              <Icon as={ExternalLink} size="sm" className="inline mr-1" />
              Reference URLs (competitor/inspiration pages — one per line)
            </label>
            <textarea
              value={refUrls}
              onChange={e => onRefUrlsChange(e.target.value)}
              placeholder={"https://competitor.com/their-great-article\nhttps://example.com/inspiring-content"}
              rows={3}
              className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] resize-none font-mono"
            />
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">We&apos;ll scrape these pages and use their structure/tone as context (up to 5 URLs)</p>
          </div>
        </div>
      )}

      <AIContextIndicator workspaceId={workspaceId} feature="briefs" />

      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          onClick={onGenerate}
          disabled={!keyword.trim() || generating}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors text-white"
        >
          <Icon as={generating ? Loader2 : Sparkles} size="md" className={generating ? 'animate-spin' : ''} />
          {generating ? 'Generating...' : 'Generate Brief'}
        </button>
        {generating && (
          <span className="t-caption-sm text-[var(--brand-text-muted)] animate-pulse">Enriching with SERP data, GA4 insights, and knowledge base...</span>
        )}
      </div>
    </div>
  );
}
