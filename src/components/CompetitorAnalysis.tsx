import { useState, useEffect } from 'react';
import {
  Loader2, TrendingUp, TrendingDown, Target, Zap, AlertTriangle,
  CheckCircle, ArrowRight, Globe, BarChart3, Shield,
} from 'lucide-react';
import { scoreColorClass, scoreBgBarClass } from './ui';
import { get, post, getOptional } from '../api/client';

interface SiteMetrics {
  score: number;
  totalPages: number;
  errors: number;
  warnings: number;
  infos: number;
  avgTitleLen: number;
  avgDescLen: number;
  ogCoverage: number;
  schemaCoverage: number;
  h1Coverage: number;
  issueCounts: Record<string, number>;
}

interface QuickWin {
  check: string;
  severity: string;
  message: string;
  recommendation: string;
}

interface SiteData {
  url: string;
  name: string;
  metrics: SiteMetrics;
  quickWins: QuickWin[];
}

interface ComparisonResult {
  mySite: SiteData;
  competitor: SiteData;
  advantages: string[];
  disadvantages: string[];
  opportunities: string[];
  comparedAt: string;
}

interface Props {
  siteId: string;
  siteUrl?: string;
}


function MetricRow({ label, myVal, theirVal, suffix = '', higher = true }: {
  label: string; myVal: number; theirVal: number; suffix?: string; higher?: boolean;
}) {
  const isBetter = higher ? myVal > theirVal : myVal < theirVal;
  const isWorse = higher ? myVal < theirVal : myVal > theirVal;
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-zinc-950/50">
      <div className="flex-1 text-xs text-zinc-400">{label}</div>
      <div className={`text-sm font-semibold w-20 text-right ${isBetter ? 'text-green-400' : isWorse ? 'text-red-400' : 'text-zinc-300'}`}>
        {myVal}{suffix}
      </div>
      <div className="w-4 flex justify-center">
        {isBetter ? <TrendingUp className="w-3 h-3 text-green-500" /> :
         isWorse ? <TrendingDown className="w-3 h-3 text-red-500" /> :
         <span className="text-zinc-500">—</span>}
      </div>
      <div className={`text-sm font-semibold w-20 text-left ${isWorse ? 'text-green-400' : isBetter ? 'text-red-400' : 'text-zinc-300'}`}>
        {theirVal}{suffix}
      </div>
    </div>
  );
}

export function CompetitorAnalysis({ siteUrl }: Props) {
  const [myUrl, setMyUrl] = useState(siteUrl || '');
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load last saved comparison for this site on mount
  useEffect(() => {
    if (!siteUrl) return;
    let cancelled = false;
    getOptional<{ result?: ComparisonResult }>(`/api/competitor-compare-latest?myUrl=${encodeURIComponent(siteUrl)}`)
      .then(snap => {
        if (cancelled || !snap?.result) return;
        setResult(snap.result);
        if (snap.result.competitor?.url) setCompetitorUrl(snap.result.competitor.url);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [siteUrl]);

  const runComparison = async () => {
    if (!myUrl.trim() || !competitorUrl.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await post<ComparisonResult & { error?: string }>('/api/competitor-compare', { myUrl: myUrl.trim(), competitorUrl: competitorUrl.trim(), maxPages: 20 });
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-500">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        <p className="text-sm">Analyzing both sites...</p>
        <p className="text-xs text-zinc-500">This may take 30-60 seconds depending on site size</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center py-12 gap-5">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-zinc-900 border border-zinc-800">
            <Target className="w-7 h-7 text-zinc-500" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-300">Competitor SEO Comparison</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm">Compare your site's SEO health against a competitor side-by-side</p>
          </div>
          <div className="w-full max-w-md space-y-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Your Site URL</label>
              <input
                type="text"
                value={myUrl}
                onChange={e => setMyUrl(e.target.value)}
                placeholder="https://yoursite.com"
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div className="flex justify-center">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-zinc-800 border border-zinc-700">
                <BarChart3 className="w-4 h-4 text-zinc-400" />
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Competitor URL</label>
              <input
                type="text"
                value={competitorUrl}
                onChange={e => setCompetitorUrl(e.target.value)}
                placeholder="https://competitor.com"
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
                onKeyDown={e => e.key === 'Enter' && runComparison()}
              />
            </div>
            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</div>
            )}
            <button
              onClick={runComparison}
              disabled={!myUrl.trim() || !competitorUrl.trim()}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 bg-teal-400 text-[#0f1219]"
            >
              Compare Sites
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { mySite, competitor } = result;
  const scoreDiff = mySite.metrics.score - competitor.metrics.score;

  return (
    <div className="space-y-5">
      {/* Header with score comparison */}
      <div className="grid grid-cols-3 gap-4">
        {/* My site score */}
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800 text-center">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">Your Site</div>
          <div className={`text-4xl font-bold ${scoreColorClass(mySite.metrics.score)}`}>{mySite.metrics.score}</div>
          <div className="text-xs text-zinc-400 mt-1 truncate" title={mySite.url}>{mySite.name}</div>
          <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${scoreBgBarClass(mySite.metrics.score)}`} style={{ width: `${mySite.metrics.score}%` }} />
          </div>
          <div className="text-xs text-zinc-500 mt-2">{mySite.metrics.totalPages} pages scanned</div>
        </div>

        {/* Versus */}
        <div className="flex flex-col items-center justify-center">
          <div className={`text-2xl font-bold ${scoreDiff > 0 ? 'text-green-400' : scoreDiff < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
            {scoreDiff > 0 ? '+' : ''}{scoreDiff}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 mt-1">Score Difference</div>
          <div className="flex items-center gap-2 mt-3">
            {scoreDiff > 0 ? (
              <span className="text-xs text-green-400 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> You're ahead</span>
            ) : scoreDiff < 0 ? (
              <span className="text-xs text-red-400 flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Room to improve</span>
            ) : (
              <span className="text-xs text-zinc-400">Even match</span>
            )}
          </div>
        </div>

        {/* Competitor score */}
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800 text-center">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">Competitor</div>
          <div className={`text-4xl font-bold ${scoreColorClass(competitor.metrics.score)}`}>{competitor.metrics.score}</div>
          <div className="text-xs text-zinc-400 mt-1 truncate" title={competitor.url}>{competitor.name}</div>
          <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${scoreBgBarClass(competitor.metrics.score)}`} style={{ width: `${competitor.metrics.score}%` }} />
          </div>
          <div className="text-xs text-zinc-500 mt-2">{competitor.metrics.totalPages} pages scanned</div>
        </div>
      </div>

      {/* Metric comparison table */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-1">
        <div className="flex items-center gap-3 px-3 pb-2 border-b border-zinc-800 mb-2">
          <div className="flex-1 text-[11px] uppercase tracking-wider text-zinc-500">Metric</div>
          <div className="w-20 text-right text-[11px] uppercase tracking-wider text-zinc-500">You</div>
          <div className="w-4" />
          <div className="w-20 text-left text-[11px] uppercase tracking-wider text-zinc-500">Them</div>
        </div>
        <MetricRow label="Overall Score" myVal={mySite.metrics.score} theirVal={competitor.metrics.score} suffix="/100" />
        <MetricRow label="Pages Indexed" myVal={mySite.metrics.totalPages} theirVal={competitor.metrics.totalPages} />
        <MetricRow label="Errors" myVal={mySite.metrics.errors} theirVal={competitor.metrics.errors} higher={false} />
        <MetricRow label="Warnings" myVal={mySite.metrics.warnings} theirVal={competitor.metrics.warnings} higher={false} />
        <MetricRow label="H1 Coverage" myVal={mySite.metrics.h1Coverage} theirVal={competitor.metrics.h1Coverage} suffix="%" />
        <MetricRow label="OG Tag Coverage" myVal={mySite.metrics.ogCoverage} theirVal={competitor.metrics.ogCoverage} suffix="%" />
        <MetricRow label="Schema Coverage" myVal={mySite.metrics.schemaCoverage} theirVal={competitor.metrics.schemaCoverage} suffix="%" />
      </div>

      {/* Advantages / Disadvantages / Opportunities */}
      <div className="grid grid-cols-3 gap-4">
        {result.advantages.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium text-green-400">Your Advantages</span>
            </div>
            <div className="space-y-2">
              {result.advantages.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                  <CheckCircle className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>{a}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {result.disadvantages.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-sm font-medium text-red-400">Competitor Leads</span>
            </div>
            <div className="space-y-2">
              {result.disadvantages.map((d, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                  <TrendingDown className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
                  <span>{d}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {result.opportunities.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium text-amber-400">Opportunities</span>
            </div>
            <div className="space-y-2">
              {result.opportunities.map((o, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                  <ArrowRight className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
                  <span>{o}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Run again */}
      <div className="flex justify-center pt-2">
        <button
          onClick={() => setResult(null)}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium transition-colors"
        >
          <Globe className="w-3.5 h-3.5" /> Compare Another Site
        </button>
      </div>
    </div>
  );
}
