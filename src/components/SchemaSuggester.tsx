import { useState, useEffect, useRef } from 'react';
import {
  Loader2, ChevronDown, ChevronRight, Copy, CheckCircle,
  AlertCircle, Info, Sparkles, RefreshCw, Upload, Send,
} from 'lucide-react';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';

interface SchemaSuggestion {
  type: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  template: Record<string, unknown>;
}

interface SchemaPageSuggestion {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  suggestedSchemas: SchemaSuggestion[];
  validationErrors?: string[];
}

interface Props {
  siteId: string;
  workspaceId?: string;
}

export function SchemaSuggester({ siteId, workspaceId }: Props) {
  const [data, setData] = useState<SchemaPageSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const [published, setPublished] = useState<Set<string>>(new Set());
  const [publishError, setPublishError] = useState<Record<string, string>>({});
  const [scanError, setScanError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<string | null>(null);
  const [sendingToClient, setSendingToClient] = useState(false);
  const [sentToClient, setSentToClient] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const { jobs, startJob, cancelJob } = useBackgroundTasks();
  const jobIdRef = useRef<string | null>(null);

  // Stream partial results from background job via WebSocket
  useEffect(() => {
    if (!jobIdRef.current) return;
    const job = jobs.find(j => j.id === jobIdRef.current);
    if (!job) return;
    if (job.result && Array.isArray(job.result) && job.result.length > 0) {
      setData(job.result as SchemaPageSuggestion[]);
    }
    if (job.message) setProgressMsg(job.message);
    if (job.status === 'done') {
      setLoading(false);
      if (job.result && Array.isArray(job.result)) {
        setData(job.result as SchemaPageSuggestion[]);
      }
      setProgressMsg(null);
      jobIdRef.current = null;
    } else if (job.status === 'error') {
      setLoading(false);
      setScanError(job.error || 'Schema generation failed');
      setProgressMsg(null);
      jobIdRef.current = null;
    } else if (job.status === 'cancelled') {
      setLoading(false);
      setProgressMsg(null);
      jobIdRef.current = null;
    }
  }, [jobs]);

  const stopScan = () => {
    if (jobIdRef.current) cancelJob(jobIdRef.current);
  };

  const sendSchemasToClient = async () => {
    if (!data || !workspaceId) return;
    setSendingToClient(true);
    try {
      const items = data.map(page => ({
        pageId: page.pageId,
        pageTitle: page.pageTitle,
        pageSlug: page.slug,
        field: 'schema',
        currentValue: page.existingSchemas.length > 0 ? page.existingSchemas.join(', ') : '',
        proposedValue: JSON.stringify(page.suggestedSchemas[0]?.template || {}, null, 2),
      }));
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['x-auth-token'] = token;
      const res = await fetch(`/api/approvals/${workspaceId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ siteId, name: 'Schema Review', items }),
      });
      if (res.ok) setSentToClient(true);
    } catch { /* skip */ }
    setSendingToClient(false);
  };

  const runScan = async () => {
    setStarted(true);
    setLoading(true);
    setData(null);
    setScanError(null);
    setProgressMsg('Starting schema generation...');
    const jobId = await startJob('schema-generator', { siteId, workspaceId: workspaceId || '' });
    if (jobId) {
      jobIdRef.current = jobId;
    } else {
      setScanError('Failed to start schema generation job');
      setLoading(false);
    }
  };

  const regeneratePage = async (pageId: string) => {
    setRegenerating(prev => new Set(prev).add(pageId));
    try {
      const res = await fetch(`/api/webflow/schema-suggestions/${siteId}/page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId }),
      });
      if (!res.ok) throw new Error('Failed');
      const result: SchemaPageSuggestion = await res.json();
      setData(prev => {
        if (!prev) return prev;
        return prev.map(p => p.pageId === pageId ? {
          ...p,
          suggestedSchemas: result.suggestedSchemas,
          existingSchemas: result.existingSchemas,
          validationErrors: result.validationErrors,
        } : p);
      });
      setExpanded(prev => new Set(prev).add(pageId));
    } catch {
      // keep existing data
    } finally {
      setRegenerating(prev => {
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
    }
  };

  const publishToWebflow = async (pageId: string, schema: Record<string, unknown>) => {
    setPublishing(prev => new Set(prev).add(pageId));
    setPublishError(prev => { const n = { ...prev }; delete n[pageId]; return n; });
    setConfirmPublish(null);
    try {
      const res = await fetch(`/api/webflow/schema-publish/${siteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, schema, publishAfter: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setPublished(prev => new Set(prev).add(pageId));
    } catch (err) {
      setPublishError(prev => ({ ...prev, [pageId]: err instanceof Error ? err.message : 'Publish failed' }));
    } finally {
      setPublishing(prev => {
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const copyTemplate = (suggestion: SchemaSuggestion, pageId: string) => {
    const json = JSON.stringify(suggestion.template, null, 2);
    const script = `<script type="application/ld+json">\n${json}\n</script>`;
    navigator.clipboard.writeText(script);
    setCopiedId(`${pageId}-${suggestion.type}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!started) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
          <Sparkles className="w-7 h-7 text-violet-400" />
        </div>
        <div className="text-center space-y-1.5">
          <p className="text-sm font-medium text-zinc-200">Schema Generator</p>
          <p className="text-xs text-zinc-500 max-w-sm">Scans all pages, generates optimized JSON-LD structured data with @graph, and validates against Google requirements. Schemas can be published directly to Webflow.</p>
        </div>
        <button
          onClick={runScan}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors mt-2"
        >
          <Sparkles className="w-4 h-4" /> Generate Schemas
        </button>
      </div>
    );
  }

  if (loading && (!data || data.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm">{progressMsg || 'Scanning pages for schema opportunities...'}</p>
        <p className="text-xs text-zinc-600">Results will appear as each batch completes</p>
        <button onClick={stopScan} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-red-400 bg-zinc-800 hover:bg-zinc-800/80 transition-colors mt-2">
          Stop
        </button>
      </div>
    );
  }

  if (scanError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-red-400 text-sm font-medium">Schema generation failed</p>
        <p className="text-zinc-500 text-xs max-w-md text-center">{scanError}</p>
        <button onClick={runScan} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors mt-2">
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <CheckCircle className="w-8 h-8 text-green-400" />
        <p className="text-zinc-400 text-sm">No schema suggestions needed</p>
        <button onClick={runScan} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors mt-2">
          <RefreshCw className="w-3 h-3" /> Re-scan
        </button>
      </div>
    );
  }

  const pagesWithExisting = data.filter(p => p.existingSchemas.length > 0).length;
  const pagesWithErrors = data.filter(p => (p.validationErrors?.length || 0) > 0).length;
  const totalTypes = data.reduce((s, p) => {
    const schema = p.suggestedSchemas[0]?.template;
    const graph = schema?.['@graph'] as Record<string, unknown>[] | undefined;
    return s + (graph?.length || 0);
  }, 0);

  return (
    <div className="space-y-4">
      {/* Progress banner while streaming */}
      {loading && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-violet-500/10 border border-violet-500/20 rounded-xl">
          <Loader2 className="w-4 h-4 animate-spin text-violet-400 flex-shrink-0" />
          <span className="text-xs text-violet-300 flex-1">{progressMsg || 'Generating schemas...'}</span>
          <button onClick={stopScan} className="text-xs text-violet-400/60 hover:text-red-400 transition-colors">
            Stop
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{data.length} pages · {totalTypes} schema types generated{loading ? ' (so far)' : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          {!loading && data.length > 0 && (
            <button
              onClick={sendSchemasToClient}
              disabled={sendingToClient || sentToClient}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-3 h-3" /> {sentToClient ? 'Sent to Client' : sendingToClient ? 'Sending...' : 'Send to Client'}
            </button>
          )}
          <button onClick={runScan} disabled={loading} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <RefreshCw className="w-3 h-3" /> Re-generate All
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Pages</div>
          <div className="text-2xl font-bold text-zinc-200">{data.length}</div>
          <div className="text-xs text-zinc-500">{totalTypes} @graph types total</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Validated</div>
          <div className={`text-2xl font-bold ${pagesWithErrors > 0 ? 'text-amber-400' : 'text-green-400'}`}>{data.length - pagesWithErrors}/{data.length}</div>
          <div className="text-xs text-zinc-500">{pagesWithErrors > 0 ? `${pagesWithErrors} with warnings` : 'all passing'}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Existing Schemas</div>
          <div className="text-2xl font-bold text-green-400">{pagesWithExisting}</div>
          <div className="text-xs text-zinc-500">pages already have JSON-LD</div>
        </div>
      </div>

      {/* Page list */}
      <div className="space-y-2">
        {data.map(page => {
          const isOpen = expanded.has(page.pageId);
          const isRegenLoading = regenerating.has(page.pageId);
          const hasErrors = (page.validationErrors?.length || 0) > 0;
          const schema = page.suggestedSchemas[0];
          const graphTypes = schema ? ((schema.template?.['@graph'] as Record<string, unknown>[]) || []).map(n => n['@type'] as string).filter(Boolean) : [];
          return (
            <div key={page.pageId} className={`bg-zinc-900 rounded-xl border overflow-hidden ${hasErrors ? 'border-amber-500/30' : 'border-zinc-800'}`}>
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => toggleExpand(page.pageId)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-zinc-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-200 truncate">{page.pageTitle}</div>
                    <div className="text-xs text-zinc-500 truncate">/{page.slug}</div>
                  </div>
                </button>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {page.existingSchemas.length > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/10 text-green-400 border border-green-500/20">
                      <CheckCircle className="w-3 h-3" /> {page.existingSchemas.length} existing
                    </span>
                  )}
                  {graphTypes.length > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20">
                      <Sparkles className="w-3 h-3" /> {graphTypes.length} types
                    </span>
                  )}
                  {hasErrors && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      <AlertCircle className="w-3 h-3" /> {page.validationErrors!.length}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); regeneratePage(page.pageId); }}
                    disabled={isRegenLoading}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50 text-zinc-500 hover:text-zinc-300 bg-zinc-800 hover:bg-zinc-700"
                    title="Regenerate schema for this page"
                  >
                    {isRegenLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              {isOpen && schema && (
                <div className="border-t border-zinc-800">
                  {/* Existing schemas */}
                  {page.existingSchemas.length > 0 && (
                    <div className="px-4 py-3 border-b border-zinc-800/50">
                      <div className="text-xs font-medium text-zinc-400 mb-2">Already on page</div>
                      <div className="flex flex-wrap gap-1.5">
                        {page.existingSchemas.map((s, i) => (
                          <span key={i} className="px-2 py-1 rounded-md text-xs font-mono bg-green-500/10 text-green-400 border border-green-500/20">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Validation errors */}
                  {hasErrors && (
                    <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/20">
                      <div className="text-xs font-medium text-amber-400 mb-1">Validation warnings</div>
                      {page.validationErrors!.map((err, i) => (
                        <div key={i} className="text-[11px] text-amber-300/80">• {err}</div>
                      ))}
                    </div>
                  )}

                  {/* Graph types */}
                  <div className="px-4 py-2 border-b border-zinc-800/50">
                    <div className="text-xs font-medium text-zinc-400 mb-1.5">@graph types</div>
                    <div className="flex flex-wrap gap-1.5">
                      {graphTypes.map((t, i) => (
                        <span key={i} className="px-2 py-1 rounded-md text-xs font-mono bg-violet-500/10 text-violet-300 border border-violet-500/20">
                          {t}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1.5">{schema.reason}</p>
                  </div>

                  {/* Unified schema preview */}
                  <div className="px-4 py-3">
                    <div className="relative">
                      <pre className="text-xs font-mono bg-zinc-950 rounded-lg p-3 overflow-x-auto text-zinc-400 border border-zinc-800 max-h-64 overflow-y-auto">
                        {JSON.stringify(schema.template, null, 2)}
                      </pre>
                      <div className="absolute top-2 right-2 flex items-center gap-1.5">
                        <button
                          onClick={() => copyTemplate(schema, page.pageId)}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                        >
                          {copiedId === `${page.pageId}-${schema.type}` ? (
                            <><CheckCircle className="w-3 h-3 text-green-400" /> Copied</>
                          ) : (
                            <><Copy className="w-3 h-3" /> Copy</>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Publish to Webflow */}
                    <div className="mt-3 flex items-center gap-2">
                      {!page.pageId.startsWith('cms-') && (
                        published.has(page.pageId) ? (
                          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                            <CheckCircle className="w-3.5 h-3.5" /> Published to Webflow
                          </span>
                        ) : confirmPublish === page.pageId ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-amber-400">Publish schema to this page's &lt;head&gt;?</span>
                            <button
                              onClick={() => publishToWebflow(page.pageId, schema.template)}
                              disabled={publishing.has(page.pageId)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 bg-green-600 hover:bg-green-500 text-white"
                            >
                              {publishing.has(page.pageId) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                              Yes, publish
                            </button>
                            <button
                              onClick={() => setConfirmPublish(null)}
                              className="px-2 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmPublish(page.pageId)}
                            disabled={publishing.has(page.pageId)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 bg-gradient-to-r from-blue-600/80 to-indigo-600/80 hover:from-blue-500 hover:to-indigo-500 text-white"
                          >
                            {publishing.has(page.pageId) ? (
                              <><Loader2 className="w-3 h-3 animate-spin" /> Publishing...</>
                            ) : (
                              <><Upload className="w-3.5 h-3.5" /> Publish to Webflow</>
                            )}
                          </button>
                        )
                      )}
                      {publishError[page.pageId] && (
                        <span className="text-xs text-red-400">{publishError[page.pageId]}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/10">
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-zinc-400">
          <strong className="text-zinc-300">How to use:</strong> Each page gets one unified <code className="text-blue-300">@graph</code> schema with cross-referenced types. Click <strong>Publish to Webflow</strong> to inject it directly into the page's <code className="text-blue-300">&lt;head&gt;</code> via the Custom Code API, or <strong>Copy</strong> to paste it manually. Existing custom code on your pages is never touched — only schema scripts are managed.
        </div>
      </div>
    </div>
  );
}
