import { useState, useCallback } from 'react';
import { Loader2, Download, RefreshCw, FileText, Copy, Check, Bot, Eye, EyeOff } from 'lucide-react';
import { SectionCard, StatCard, EmptyState, PageHeader } from './ui';
import { llmsTxt } from '../api/content';

interface LlmsTxtResult {
  content: string;
  pageCount: number;
  generatedAt: string;
}

interface LlmsTxtGeneratorProps {
  workspaceId: string;
}

export function LlmsTxtGenerator({ workspaceId }: LlmsTxtGeneratorProps) {
  const [data, setData] = useState<LlmsTxtResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

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
    try {
      await navigator.clipboard.writeText(data.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('LlmsTxtGenerator operation failed:', err);
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = data.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [data]);

  const handleDownload = useCallback(() => {
    // Direct link to the download endpoint
    window.open(llmsTxt.downloadUrl(workspaceId), '_blank');
  }, [workspaceId]);

  // Count sections and lines in the generated content
  const stats = data ? {
    lines: data.content.split('\n').filter(l => l.trim()).length,
    sections: (data.content.match(/^## /gm) || []).length,
    chars: data.content.length,
  } : null;

  if (!data && !loading && !error) {
    return (
      <div className="space-y-4">
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
    <div className="space-y-4">
      <PageHeader
        title="LLMs.txt Generator"
        subtitle={data ? `${data.pageCount} pages · Generated ${new Date(data.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Generating…'}
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
                  Download .txt
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
          <span className="text-sm text-zinc-400">Generating LLMs.txt…</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-500/5 border border-red-500/15">
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
            title="LLMs.txt Preview"
            titleIcon={<FileText className="w-4 h-4 text-teal-400" />}
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
                  {data.content}
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
                <strong className="text-zinc-300">How to use it:</strong> Download the file and place it at the root of your website (e.g., <code className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-300">yoursite.com/llms.txt</code>).
                This can be done via Webflow&apos;s custom code settings or by hosting it on your CDN.
              </p>
              <p>
                <strong className="text-zinc-300">Benefits:</strong> Helps AI assistants accurately describe your business, improves how your site appears in AI-generated summaries, and ensures your content strategy reaches AI-powered search.
              </p>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
