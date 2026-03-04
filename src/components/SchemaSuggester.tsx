import { useState, useCallback } from 'react';
import {
  Loader2, Code2, ChevronDown, ChevronRight, Copy, CheckCircle,
  AlertCircle, Info, Sparkles,
} from 'lucide-react';

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
}

const PRIORITY_DOT = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-green-400',
};

interface Props {
  siteId: string;
}

export function SchemaSuggester({ siteId }: Props) {
  const [data, setData] = useState<SchemaPageSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const run = useCallback(() => {
    setLoading(true);
    fetch(`/api/webflow/schema-suggestions/${siteId}`)
      .then(r => r.json())
      .then(d => setData(Array.isArray(d) ? d : []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [siteId]);

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

  if (!data && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center">
          <Code2 className="w-8 h-8 text-zinc-600" />
        </div>
        <p className="text-zinc-400 text-sm">JSON-LD Schema Suggester</p>
        <p className="text-xs text-zinc-600 max-w-md text-center">
          Analyzes each page and suggests appropriate structured data schemas (Organization, Article, FAQ, etc.) to improve search result appearance
        </p>
        <button
          onClick={run}
          className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm font-medium transition-colors"
        >
          Analyze Pages
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm">Scanning pages for schema opportunities...</p>
        <p className="text-xs text-zinc-600">Checking existing JSON-LD and suggesting improvements</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <CheckCircle className="w-8 h-8 text-green-400" />
        <p className="text-zinc-400 text-sm">No schema suggestions needed</p>
      </div>
    );
  }

  const totalSuggestions = data.reduce((s, p) => s + p.suggestedSchemas.length, 0);
  const highPriority = data.reduce((s, p) => s + p.suggestedSchemas.filter(sg => sg.priority === 'high').length, 0);
  const pagesWithExisting = data.filter(p => p.existingSchemas.length > 0).length;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Suggestions</div>
          <div className="text-2xl font-bold text-zinc-200">{totalSuggestions}</div>
          <div className="text-xs text-zinc-500">across {data.length} pages</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">High Priority</div>
          <div className="text-2xl font-bold text-red-400">{highPriority}</div>
          <div className="text-xs text-zinc-500">should implement first</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Existing Schemas</div>
          <div className="text-2xl font-bold text-green-400">{pagesWithExisting}</div>
          <div className="text-xs text-zinc-500">pages with JSON-LD</div>
        </div>
      </div>

      {/* Page list */}
      <div className="space-y-2">
        {data.map(page => {
          const isOpen = expanded.has(page.pageId);
          return (
            <div key={page.pageId} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <button
                onClick={() => toggleExpand(page.pageId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
              >
                {isOpen ? <ChevronDown className="w-4 h-4 text-zinc-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-200 truncate">{page.pageTitle}</div>
                  <div className="text-xs text-zinc-500 truncate">/{page.slug}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {page.existingSchemas.length > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/10 text-green-400 border border-green-500/20">
                      <CheckCircle className="w-3 h-3" /> {page.existingSchemas.length} existing
                    </span>
                  )}
                  {page.suggestedSchemas.length > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      <Sparkles className="w-3 h-3" /> {page.suggestedSchemas.length} suggested
                    </span>
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-zinc-800 divide-y divide-zinc-800/50">
                  {/* Existing schemas */}
                  {page.existingSchemas.length > 0 && (
                    <div className="px-4 py-3">
                      <div className="text-xs font-medium text-zinc-400 mb-2">Existing Schemas</div>
                      <div className="flex flex-wrap gap-1.5">
                        {page.existingSchemas.map((s, i) => (
                          <span key={i} className="px-2 py-1 rounded-md text-xs font-mono bg-green-500/10 text-green-400 border border-green-500/20">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggestions */}
                  {page.suggestedSchemas.map((suggestion, i) => {
                    const copyId = `${page.pageId}-${suggestion.type}`;
                    return (
                      <div key={i} className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${PRIORITY_DOT[suggestion.priority]}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-zinc-200">{suggestion.type}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                suggestion.priority === 'high' ? 'bg-red-500/10 text-red-400' :
                                suggestion.priority === 'medium' ? 'bg-amber-500/10 text-amber-400' :
                                'bg-green-500/10 text-green-400'
                              }`}>
                                {suggestion.priority}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-400 mb-2">{suggestion.reason}</p>

                            {/* Template preview */}
                            <div className="relative">
                              <pre className="text-xs font-mono bg-zinc-950 rounded-lg p-3 overflow-x-auto text-zinc-400 border border-zinc-800 max-h-48 overflow-y-auto">
                                {JSON.stringify(suggestion.template, null, 2)}
                              </pre>
                              <button
                                onClick={() => copyTemplate(suggestion, page.pageId)}
                                className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                              >
                                {copiedId === copyId ? (
                                  <><CheckCircle className="w-3 h-3 text-green-400" /> Copied</>
                                ) : (
                                  <><Copy className="w-3 h-3" /> Copy</>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/10">
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-zinc-400">
          <strong className="text-zinc-300">How to use:</strong> Copy the JSON-LD template, customize the placeholder values, and paste it into the page's custom code section in Webflow (Page Settings → Custom Code → Head Code).
        </div>
      </div>

      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
        <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-zinc-400">
          <strong className="text-zinc-300">Internal tool:</strong> This tool is for internal use only and is not visible to clients in reports.
        </div>
      </div>
    </div>
  );
}
