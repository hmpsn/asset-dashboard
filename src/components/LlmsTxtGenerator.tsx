import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Download, RefreshCw, FileText, Copy, Check, Bot, Eye, EyeOff, Clock } from 'lucide-react';
import { SectionCard, StatCard, EmptyState, PageHeader, Button, Icon, cn } from './ui';
import { llmsTxt } from '../api/content';
import { queryKeys } from '../lib/queryKeys';
import { STALE_TIMES } from '../lib/queryClient';

interface LlmsTxtResult {
  content: string;
  fullContent: string;
  pageCount: number;
  generatedAt: string;
}

interface LlmsTxtGeneratorProps {
  workspaceId: string;
}

function formatFreshness(ts: string | null | undefined): { label: string; color: string } {
  if (!ts) return { label: 'Never generated', color: 'text-[var(--brand-text-muted)]' };
  const ageMs = Date.now() - new Date(ts).getTime();
  const hours = ageMs / (1000 * 60 * 60);
  if (hours < 1) return { label: 'Generated just now', color: 'text-accent-success' };
  if (hours < 24) return { label: `Generated ${Math.round(hours)}h ago`, color: 'text-accent-success' };
  if (hours < 72) return { label: `Generated ${Math.round(hours / 24)}d ago`, color: 'text-accent-warning' };
  return { label: `Generated ${Math.round(hours / 24)}d ago — consider regenerating`, color: 'text-accent-warning' };
}

export function LlmsTxtGenerator({ workspaceId }: LlmsTxtGeneratorProps) {
  const [data, setData] = useState<LlmsTxtResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [previewMode, setPreviewMode] = useState<'index' | 'full'>('index');

  const { data: freshnessData } = useQuery({
    queryKey: queryKeys.admin.llmsTxtFreshness(workspaceId),
    queryFn: () => llmsTxt.freshness(workspaceId),
    staleTime: STALE_TIMES.NORMAL,
    enabled: !!workspaceId,
  });

  const freshness = formatFreshness(freshnessData?.lastGeneratedAt ?? data?.generatedAt);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await llmsTxt.generate(workspaceId);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate LLMs.txt');
    }
    setLoading(false);
  }, [workspaceId]);

  const handleCopy = useCallback(async () => {
    if (!data) return;
    const text = previewMode === 'full' ? data.fullContent : data.content;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('LlmsTxtGenerator operation failed:', err);
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [data, previewMode]);

  const handleDownload = useCallback(() => {
    window.open(llmsTxt.downloadUrl(workspaceId), '_blank');
  }, [workspaceId]);

  const handleDownloadFull = useCallback(() => {
    window.open(llmsTxt.downloadFullUrl(workspaceId), '_blank');
  }, [workspaceId]);

  const previewContent = data ? (previewMode === 'full' ? data.fullContent : data.content) : '';

  const stats = data ? {
    lines: previewContent.split('\n').filter(l => l.trim()).length,
    sections: (previewContent.match(/^## /gm) || []).length,
    chars: previewContent.length,
  } : null;

  if (!data && !loading && !error) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="LLMs.txt Generator"
          subtitle="Generate an LLMs.txt file to help AI models understand your site"
          icon={<Icon as={Bot} size="lg" className="text-accent-brand" />}
        />
        <EmptyState
          icon={Bot}
          title="Generate your LLMs.txt file"
          description="LLMs.txt is an emerging standard (like robots.txt) that helps AI models understand your site's structure, purpose, and content. Click generate to create one from your Webflow pages, keyword strategy, and content plans."
          action={
            <Button variant="ghost" size="md" icon={Bot} onClick={generate}>
              Generate LLMs.txt
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="LLMs.txt Generator"
        subtitle={
          <span className="flex items-center gap-2">
            <span>{data ? `${data.pageCount} pages · Generated ${new Date(data.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Generating…'}</span>
            <span className={`flex items-center gap-1 text-xs ${freshness.color}`}>
              <Icon as={Clock} size="sm" />{freshness.label}
            </span>
          </span>
        }
        icon={<Icon as={Bot} size="lg" className="text-accent-brand" />}
        actions={
          <div className="flex items-center gap-2">
            {data && (
              <>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--surface-3)] text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)] transition-colors"
                >
                  {copied ? <Icon as={Check} size="sm" className="text-accent-success" /> : <Icon as={Copy} size="sm" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-[var(--radius-md)] bg-teal-500/10 text-accent-brand hover:bg-teal-500/15 transition-colors"
                >
                  <Icon as={Download} size="sm" />
                  llms.txt
                </button>
                <button
                  onClick={handleDownloadFull}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-[var(--radius-md)] bg-teal-500/10 text-accent-brand hover:bg-teal-500/15 transition-colors"
                >
                  <Icon as={Download} size="sm" />
                  llms-full.txt
                </button>
              </>
            )}
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--surface-3)] text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)] transition-colors disabled:opacity-50"
            >
              <Icon as={RefreshCw} size="sm" className={loading ? 'animate-spin' : ''} />
              {loading ? 'Generating…' : 'Regenerate'}
            </button>
          </div>
        }
      />

      {loading && !data && (
        <div className="flex items-center justify-center py-24 gap-3">
          <Icon as={Loader2} size="lg" className="animate-spin text-accent-brand" />
          <span className="text-sm text-[var(--brand-text)]">Generating LLMs.txt with AI summaries…</span>
        </div>
      )}

      {error && (
        // pr-check-disable-next-line -- brand signature radius intentional for featured error banner surface
        <div className="flex items-start gap-2 px-4 py-3 bg-red-500/5 border border-red-500/15" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <span className="text-xs text-accent-danger">{error}</span>
        </div>
      )}

      {data && (
        <>
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Pages Indexed" value={data.pageCount} icon={FileText} iconColor="#2dd4bf" />
              <StatCard label="Sections" value={stats.sections} icon={Bot} iconColor="#60a5fa" />
              <StatCard label="Content Lines" value={stats.lines} icon={FileText} iconColor="#a78bfa" />
              <StatCard label="File Size" value={stats.chars > 1024 ? `${(stats.chars / 1024).toFixed(1)} KB` : `${stats.chars} B`} icon={Download} iconColor="#4ade80" />
            </div>
          )}

          {/* Preview */}
          <SectionCard
            title="Preview"
            titleIcon={<Icon as={FileText} size="md" className="text-accent-brand" />}
            titleExtra={
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => setPreviewMode('index')}
                  className={cn(
                    't-caption-sm px-2 py-0.5 rounded-[var(--radius-pill)] transition-colors',
                    previewMode === 'index' ? 'bg-teal-500/15 text-accent-brand' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]',
                  )}
                >
                  llms.txt
                </button>
                <button
                  onClick={() => setPreviewMode('full')}
                  className={cn(
                    't-caption-sm px-2 py-0.5 rounded-[var(--radius-pill)] transition-colors',
                    previewMode === 'full' ? 'bg-teal-500/15 text-accent-brand' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]',
                  )}
                >
                  llms-full.txt
                </button>
              </div>
            }
            action={
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
              >
                {showPreview ? <Icon as={EyeOff} size="sm" /> : <Icon as={Eye} size="sm" />}
                {showPreview ? 'Hide' : 'Show'}
              </button>
            }
            noPadding={showPreview}
          >
            {showPreview && (
              <div className="max-h-[500px] overflow-y-auto">
                <pre className="px-4 py-3 text-xs font-mono text-[var(--brand-text)] whitespace-pre-wrap leading-relaxed">
                  {previewContent}
                </pre>
              </div>
            )}
            {!showPreview && (
              <p className="text-xs text-[var(--brand-text-muted)]">Preview hidden. Click Show to reveal the generated content.</p>
            )}
          </SectionCard>

          {/* What is LLMs.txt info card */}
          <SectionCard
            title="What is LLMs.txt?"
            titleIcon={<Icon as={Bot} size="md" className="text-[var(--brand-text-muted)]" />}
          >
            <div className="space-y-2 text-xs text-[var(--brand-text)] leading-relaxed">
              <p>
                <strong className="text-[var(--brand-text-bright)]">LLMs.txt</strong> is an emerging standard that provides structured information about your website for AI language models.
                Similar to how <code className="px-1 py-0.5 bg-[var(--surface-3)] rounded text-[var(--brand-text-bright)]">robots.txt</code> guides search engine crawlers, LLMs.txt helps AI systems understand your site&apos;s structure and content.
              </p>
              <p>
                <strong className="text-[var(--brand-text-bright)]">Two files are generated:</strong> <code className="px-1 py-0.5 bg-[var(--surface-3)] rounded text-[var(--brand-text-bright)]">llms.txt</code> is a lightweight index with links and one-line descriptions for quick discovery.
                <code className="px-1 py-0.5 bg-[var(--surface-3)] rounded text-[var(--brand-text-bright)] ml-1">llms-full.txt</code> includes AI-generated summaries per page for deep understanding.
              </p>
              <p>
                <strong className="text-[var(--brand-text-bright)]">How to use:</strong> Download both files and place them at the root of your website (e.g., <code className="px-1 py-0.5 bg-[var(--surface-3)] rounded text-[var(--brand-text-bright)]">yoursite.com/llms.txt</code>).
                This can be done via Webflow&apos;s custom code settings or by hosting on your CDN.
              </p>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
