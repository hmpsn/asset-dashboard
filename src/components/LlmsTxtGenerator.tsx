import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Download, RefreshCw, FileText, Copy, Check, Bot, Eye, EyeOff, Clock } from 'lucide-react';
import { SectionCard, StatCard, EmptyState, PageHeader } from './ui';
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
  if (!ts) return { label: 'Never generated', color: 'text-zinc-500' };
  const ageMs = Date.now() - new Date(ts).getTime();
  const hours = ageMs / (1000 * 60 * 60);
  if (hours < 1) return { label: 'Generated just now', color: 'text-green-400' };
  if (hours < 24) return { label: `Generated ${Math.round(hours)}h ago`, color: 'text-green-400' };
  if (hours < 72) return { label: `Generated ${Math.round(hours / 24)}d ago`, color: 'text-amber-400' };
  return { label: `Generated ${Math.round(hours / 24)}d ago — consider regenerating`, color: 'text-amber-400' };
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
          icon={<Bot className="w-5 h-5 text-teal-400" />}
        />
        <EmptyState
          icon={Bot}
          title="Generate your LLMs.txt file"
          description="LLMs.txt is an emerging standard (like robots.txt) that helps AI models understand your site's structure, purpose, and content. Click generate to create one from your Webflow pages, keyword strategy, and content plans."
          action={
            <button
              onClick={generate}
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/15 transition-colors font-medium"
            >
              <Bot className="w-3.5 h-3.5" />
              Generate LLMs.txt
            </button>
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
              <Clock className="w-3 h-3" />{freshness.label}
            </span>
          </span>
        }
        icon={<Bot className="w-5 h-5 text-teal-400" />}
        actions={
          <div className="flex items-center gap-2">
            {data && (
              <>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                >
                  {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/15 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  llms.txt
                </button>
                <button
                  onClick={handleDownloadFull}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/15 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  llms-full.txt
                </button>
              </>
            )}
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Generating…' : 'Regenerate'}
            </button>
          </div>
        }
      />

      {loading && !data && (
        <div className="flex items-center justify-center py-24 gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
          <span className="text-sm text-zinc-400">Generating LLMs.txt with AI summaries…</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-500/5 border border-red-500/15" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <span className="text-xs text-red-400">{error}</span>
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
            titleIcon={<FileText className="w-4 h-4 text-teal-400" />}
            titleExtra={
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => setPreviewMode('index')}
                  className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${previewMode === 'index' ? 'bg-teal-500/15 text-teal-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  llms.txt
                </button>
                <button
                  onClick={() => setPreviewMode('full')}
                  className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${previewMode === 'full' ? 'bg-teal-500/15 text-teal-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  llms-full.txt
                </button>
              </div>
            }
            action={
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showPreview ? 'Hide' : 'Show'}
              </button>
            }
            noPadding={showPreview}
          >
            {showPreview && (
              <div className="max-h-[500px] overflow-y-auto">
                <pre className="px-4 py-3 text-xs font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed">
                  {previewContent}
                </pre>
              </div>
            )}
            {!showPreview && (
              <p className="text-xs text-zinc-500">Preview hidden. Click Show to reveal the generated content.</p>
            )}
          </SectionCard>

          {/* What is LLMs.txt info card */}
          <SectionCard
            title="What is LLMs.txt?"
            titleIcon={<Bot className="w-4 h-4 text-zinc-500" />}
          >
            <div className="space-y-2 text-xs text-zinc-400 leading-relaxed">
              <p>
                <strong className="text-zinc-300">LLMs.txt</strong> is an emerging standard that provides structured information about your website for AI language models.
                Similar to how <code className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-300">robots.txt</code> guides search engine crawlers, LLMs.txt helps AI systems understand your site&apos;s structure and content.
              </p>
              <p>
                <strong className="text-zinc-300">Two files are generated:</strong> <code className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-300">llms.txt</code> is a lightweight index with links and one-line descriptions for quick discovery.
                <code className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-300 ml-1">llms-full.txt</code> includes AI-generated summaries per page for deep understanding.
              </p>
              <p>
                <strong className="text-zinc-300">How to use:</strong> Download both files and place them at the root of your website (e.g., <code className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-300">yoursite.com/llms.txt</code>).
                This can be done via Webflow&apos;s custom code settings or by hosting on your CDN.
              </p>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
