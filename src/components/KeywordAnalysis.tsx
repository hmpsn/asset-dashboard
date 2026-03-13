import { useState, useEffect } from 'react';
import {
  Loader2, ChevronDown, ChevronRight, Target, AlertCircle,
  BarChart3, Sparkles, Search as SearchIcon, TrendingUp,
  CheckCircle, Tag, Zap, BookOpen,
} from 'lucide-react';
import { scoreColorClass, scoreBgBarClass } from './ui';
import { get, post } from '../api/client';

interface PageMeta {
  id: string;
  title: string;
  slug: string;
  publishedPath?: string | null;
  seo?: { title?: string | null; description?: string | null };
}

interface KeywordPresence {
  inTitle: boolean;
  inMeta: boolean;
  inContent: boolean;
  inSlug: boolean;
}

interface KeywordData {
  primaryKeyword: string;
  primaryKeywordPresence: KeywordPresence;
  secondaryKeywords: string[];
  longTailKeywords: string[];
  searchIntent: string;
  searchIntentConfidence: number;
  contentGaps: string[];
  competitorKeywords: string[];
  optimizationScore: number;
  optimizationIssues: string[];
  recommendations: string[];
  estimatedDifficulty: string;
  topicCluster: string;
}

interface ContentScore {
  wordCount: number;
  sentenceCount: number;
  avgWordsPerSentence: number;
  readabilityScore: number;
  readabilityGrade: string;
  headings: { total: number; h1: number; h2: number; texts: string[] };
  topKeywords: Array<{ word: string; count: number; density: number }>;
  titleLength: number;
  descLength: number;
  titleOk: boolean;
  descOk: boolean;
}

interface Props {
  siteId: string;
}


function difficultyColor(d: string): string {
  if (d === 'low') return 'text-green-400';
  if (d === 'medium') return 'text-amber-400';
  return 'text-red-400';
}

function intentIcon(intent: string): string {
  if (intent === 'informational') return 'i';
  if (intent === 'transactional') return '$';
  if (intent === 'navigational') return '→';
  return '?';
}

export function KeywordAnalysis({ siteId }: Props) {
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, KeywordData>>({});
  const [contentScores, setContentScores] = useState<Record<string, ContentScore>>({});
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    get<PageMeta[]>(`/api/webflow/pages/${siteId}`)
      .then(data => setPages(data))
      .catch(() => setPages([]))
      .finally(() => setLoading(false));
  }, [siteId]);

  const analyzePage = async (page: PageMeta) => {
    setAnalyzing(prev => new Set(prev).add(page.id));
    try {
      const slug = page.slug || '';

      // Fetch actual published page HTML for content analysis
      let pageContent = '';
      try {
        const pagePath = page.publishedPath || (page.slug ? `/${page.slug}` : '');
        if (pagePath) {
          const result = await get<{ text?: string }>(`/api/webflow/page-html/${siteId}?path=${encodeURIComponent(pagePath)}`);
          pageContent = result.text || '';
        }
      } catch { /* fall back to empty content */ }

      // Run keyword analysis and content score in parallel
      const [kwData, csData] = await Promise.all([
        post<KeywordData & { error?: string }>('/api/webflow/keyword-analysis', {
          pageTitle: page.title,
          seoTitle: page.seo?.title,
          metaDescription: page.seo?.description,
          slug,
          pageContent,
        }),
        post<ContentScore & { error?: string }>('/api/webflow/content-score', {
          pageTitle: page.title,
          seoTitle: page.seo?.title,
          metaDescription: page.seo?.description,
          pageContent,
        }),
      ]);

      if (!kwData.error) {
        setAnalyses(prev => ({ ...prev, [page.id]: kwData }));
      }
      if (!csData.error) {
        setContentScores(prev => ({ ...prev, [page.id]: csData }));
      }
    } catch (err) {
      console.error('Analysis failed:', err);
    } finally {
      setAnalyzing(prev => { const n = new Set(prev); n.delete(page.id); return n; });
    }
  };

  const toggleExpand = (id: string, page: PageMeta) => {
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      if (!analyses[id] && !analyzing.has(id)) {
        analyzePage(page);
      }
    }
  };

  const filtered = pages.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.title.toLowerCase().includes(q) || (p.slug || '').toLowerCase().includes(q);
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        <p className="text-sm">Loading pages...</p>
      </div>
    );
  }

  const analyzedCount = Object.keys(analyses).length;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-sm text-zinc-400">
          <span className="font-medium text-zinc-200">{pages.length}</span> pages
        </div>
        {analyzedCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-teal-500/10 border border-teal-500/30 text-teal-400">
            {analyzedCount} analyzed
          </span>
        )}
        <div className="flex-1" />
        <div className="text-[11px] text-zinc-500 max-w-xs text-right">
          Click a page to run AI keyword analysis. Each analysis uses GPT-4o-mini.
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search pages..."
          className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
        />
      </div>

      {/* Page list */}
      <div className="space-y-2">
        {filtered.map(page => {
          const isExpanded = expanded === page.id;
          const isAnalyzing = analyzing.has(page.id);
          const kw = analyses[page.id];
          const cs = contentScores[page.id];

          return (
            <div key={page.id} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <button
                onClick={() => toggleExpand(page.id, page)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/50 transition-colors text-left"
              >
                {isAnalyzing ? (
                  <Loader2 className="w-3.5 h-3.5 text-teal-400 animate-spin shrink-0" />
                ) : isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-200 truncate">{page.title}</div>
                  <div className="text-xs text-zinc-500 truncate">/{page.slug}</div>
                </div>
                {kw && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
                      {kw.primaryKeyword}
                    </span>
                    <span className={`text-xs font-bold tabular-nums ${scoreColorClass(kw.optimizationScore)}`}>
                      {kw.optimizationScore}
                    </span>
                  </div>
                )}
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 bg-zinc-900/30">
                  {isAnalyzing && !kw && (
                    <div className="flex items-center gap-2 py-6 justify-center text-zinc-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Running AI keyword analysis...</span>
                    </div>
                  )}

                  {kw && (
                    <div className="space-y-4 pt-2">
                      {/* Top row: Score + Intent + Difficulty */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Optimization</div>
                          <div className={`text-2xl font-bold ${scoreColorClass(kw.optimizationScore)}`}>
                            {kw.optimizationScore}
                            <span className="text-xs font-normal text-zinc-500">/100</span>
                          </div>
                          <div className="mt-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${scoreBgBarClass(kw.optimizationScore)}`} style={{ width: `${kw.optimizationScore}%` }} />
                          </div>
                        </div>
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Search Intent</div>
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-teal-500/20 text-teal-400 flex items-center justify-center text-xs font-bold">
                              {intentIcon(kw.searchIntent)}
                            </span>
                            <div>
                              <div className="text-sm font-medium text-zinc-200 capitalize">{kw.searchIntent}</div>
                              <div className="text-[11px] text-zinc-500">{Math.round(kw.searchIntentConfidence * 100)}% confidence</div>
                            </div>
                          </div>
                        </div>
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Difficulty</div>
                          <div className={`text-lg font-bold capitalize ${difficultyColor(kw.estimatedDifficulty)}`}>
                            {kw.estimatedDifficulty}
                          </div>
                          <div className="text-[11px] text-zinc-500 mt-0.5">Cluster: {kw.topicCluster}</div>
                        </div>
                      </div>

                      {/* Primary keyword */}
                      <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                        <div className="flex items-center gap-2 mb-2">
                          <Target className="w-3.5 h-3.5 text-teal-400" />
                          <span className="text-xs font-medium text-zinc-300">Primary Keyword</span>
                        </div>
                        <div className="text-sm font-semibold text-white mb-2">{kw.primaryKeyword}</div>
                        <div className="flex items-center gap-3 flex-wrap">
                          {(['inTitle', 'inMeta', 'inContent', 'inSlug'] as const).map(key => {
                            const labels = { inTitle: 'Title', inMeta: 'Meta', inContent: 'Content', inSlug: 'URL' };
                            const present = kw.primaryKeywordPresence[key];
                            return (
                              <div key={key} className="flex items-center gap-1">
                                {present ? (
                                  <CheckCircle className="w-3 h-3 text-green-400" />
                                ) : (
                                  <AlertCircle className="w-3 h-3 text-red-400" />
                                )}
                                <span className={`text-[11px] ${present ? 'text-green-400' : 'text-red-400'}`}>
                                  {labels[key]}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Keywords grid */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="flex items-center gap-2 mb-2">
                            <Tag className="w-3.5 h-3.5 text-blue-400" />
                            <span className="text-xs font-medium text-zinc-300">Secondary Keywords</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {kw.secondaryKeywords.map((k, i) => (
                              <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400">
                                {k}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                            <span className="text-xs font-medium text-zinc-300">Long-Tail Keywords</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {kw.longTailKeywords.map((k, i) => (
                              <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-400">
                                {k}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Competitor keywords */}
                      {kw.competitorKeywords.length > 0 && (
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="flex items-center gap-2 mb-2">
                            <Zap className="w-3.5 h-3.5 text-amber-400" />
                            <span className="text-xs font-medium text-zinc-300">Competitor Keywords</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {kw.competitorKeywords.map((k, i) => (
                              <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">
                                {k}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Content gaps */}
                      {kw.contentGaps.length > 0 && (
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertCircle className="w-3.5 h-3.5 text-orange-400" />
                            <span className="text-xs font-medium text-zinc-300">Content Gaps</span>
                          </div>
                          <ul className="space-y-1">
                            {kw.contentGaps.map((gap, i) => (
                              <li key={i} className="text-xs text-zinc-400 flex items-start gap-1.5">
                                <span className="text-orange-400 mt-0.5">•</span> {gap}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Recommendations + Issues */}
                      <div className="grid grid-cols-2 gap-3">
                        {kw.optimizationIssues.length > 0 && (
                          <div className="bg-zinc-900 rounded-lg p-3 border border-red-500/20">
                            <div className="flex items-center gap-2 mb-2">
                              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                              <span className="text-xs font-medium text-zinc-300">Issues</span>
                            </div>
                            <ul className="space-y-1">
                              {kw.optimizationIssues.map((issue, i) => (
                                <li key={i} className="text-[11px] text-zinc-400">{issue}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {kw.recommendations.length > 0 && (
                          <div className="bg-zinc-900 rounded-lg p-3 border border-green-500/20">
                            <div className="flex items-center gap-2 mb-2">
                              <Sparkles className="w-3.5 h-3.5 text-green-400" />
                              <span className="text-xs font-medium text-zinc-300">Recommendations</span>
                            </div>
                            <ul className="space-y-1">
                              {kw.recommendations.map((rec, i) => (
                                <li key={i} className="text-[11px] text-zinc-400">{rec}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* Content metrics */}
                      {cs && (
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="flex items-center gap-2 mb-3">
                            <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                            <span className="text-xs font-medium text-zinc-300">Content Metrics</span>
                          </div>
                          <div className="grid grid-cols-4 gap-3 mb-3">
                            <div>
                              <div className="text-lg font-bold text-zinc-200">{cs.wordCount}</div>
                              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Words</div>
                            </div>
                            <div>
                              <div className={`text-lg font-bold ${cs.readabilityScore >= 60 ? 'text-green-400' : cs.readabilityScore >= 30 ? 'text-amber-400' : 'text-red-400'}`}>
                                {cs.readabilityScore}
                              </div>
                              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Readability</div>
                            </div>
                            <div>
                              <div className="text-lg font-bold text-zinc-200">{cs.headings.total}</div>
                              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Headings</div>
                            </div>
                            <div>
                              <div className="text-lg font-bold text-zinc-200">{cs.avgWordsPerSentence}</div>
                              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Words/Sent</div>
                            </div>
                          </div>

                          {/* Top keywords from content */}
                          {cs.topKeywords.length > 0 && (
                            <div>
                              <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Top Words in Content</div>
                              <div className="flex flex-wrap gap-1">
                                {cs.topKeywords.slice(0, 10).map((kw, i) => (
                                  <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                                    {kw.word} <span className="text-cyan-600">({kw.density}%)</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Title/desc length */}
                          <div className="flex items-center gap-4 mt-3">
                            <div className="flex items-center gap-1.5">
                              {cs.titleOk ? <CheckCircle className="w-3 h-3 text-green-400" /> : <AlertCircle className="w-3 h-3 text-amber-400" />}
                              <span className="text-[11px] text-zinc-400">Title: {cs.titleLength} chars</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {cs.descOk ? <CheckCircle className="w-3 h-3 text-green-400" /> : <AlertCircle className="w-3 h-3 text-amber-400" />}
                              <span className="text-[11px] text-zinc-400">Desc: {cs.descLength} chars</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <BookOpen className="w-3 h-3 text-zinc-500" />
                              <span className="text-[11px] text-zinc-400">
                                {cs.readabilityGrade} ({cs.readabilityScore})
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
