import { useState, useEffect } from 'react';
import { get } from '../../api/client';
import {
  Loader2, TrendingUp, Globe, Search, Link2,
  DollarSign, Target, ChevronDown, ChevronRight,
} from 'lucide-react';
import { SectionCard, StatCard } from '../ui';

interface DomainOverview {
  domain: string;
  organicKeywords: number;
  organicTraffic: number;
  organicCost: number;
  paidKeywords: number;
  paidTraffic: number;
  paidCost: number;
}

interface BacklinksOverview {
  totalBacklinks: number;
  referringDomains: number;
}

interface DomainKeyword {
  keyword: string;
  position: number;
  volume: number;
  difficulty: number;
  url: string;
  traffic: number;
}

interface KeywordGap {
  keyword: string;
  volume: number;
  difficulty: number;
  competitorPosition: number;
  competitorDomain: string;
}

interface DomainData {
  domain: string;
  isOwn: boolean;
  overview: DomainOverview | null;
  backlinks: BacklinksOverview | null;
  topKeywords: DomainKeyword[];
}

interface IntelResponse {
  domains: DomainData[];
  keywordGaps: KeywordGap[];
  fetchedAt: string;
}

interface Props {
  workspaceId: string;
  competitors: string[];
  semrushAvailable: boolean;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function difficultyColor(kd: number): string {
  if (kd < 30) return 'text-green-400';
  if (kd < 60) return 'text-amber-400';
  return 'text-red-400';
}

function ComparisonBar({ myVal, theirVal, label }: { myVal: number; theirVal: number; label: string }) {
  const total = myVal + theirVal || 1;
  const myPct = Math.round((myVal / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-teal-400 font-medium">{fmtNum(myVal)}</span>
        <span className="text-zinc-500">{label}</span>
        <span className="text-orange-400 font-medium">{fmtNum(theirVal)}</span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden flex">
        <div className="h-full bg-teal-500/70 rounded-l-full transition-all" style={{ width: `${myPct}%` }} />
        <div className="h-full bg-orange-500/70 rounded-r-full transition-all" style={{ width: `${100 - myPct}%` }} />
      </div>
    </div>
  );
}

export function CompetitiveIntel({ workspaceId, competitors, semrushAvailable }: Props) {
  const [data, setData] = useState<IntelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchIntel = async () => {
    if (!competitors.length || !semrushAvailable) return;
    setLoading(true);
    setError(null);
    try {
      const comps = competitors.join(',');
      const result = await get<IntelResponse>(`/api/semrush/competitive-intel/${workspaceId}?competitors=${encodeURIComponent(comps)}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch competitive data');
    } finally {
      setLoading(false);
    }
  };

  const competitorKey = competitors.join(',');
  useEffect(() => {
    if (competitors.length > 0 && semrushAvailable) {
      fetchIntel();
    }
  }, [workspaceId, competitorKey, semrushAvailable]); // fetchIntel is stable — reads from closure

  if (!semrushAvailable) {
    return (
      <SectionCard>
        <div className="flex items-center gap-3 py-6 justify-center">
          <Target className="w-5 h-5 text-zinc-500" />
          <div>
            <p className="text-sm text-zinc-400">Competitive Intelligence requires SEMRush</p>
            <p className="text-xs text-zinc-500 mt-0.5">Configure your SEMRush API key in Settings to unlock this feature.</p>
          </div>
        </div>
      </SectionCard>
    );
  }

  if (!competitors.length) {
    return (
      <SectionCard>
        <div className="flex items-center gap-3 py-6 justify-center">
          <Globe className="w-5 h-5 text-zinc-500" />
          <div>
            <p className="text-sm text-zinc-400">Add competitor domains above</p>
            <p className="text-xs text-zinc-500 mt-0.5">Enter competitors in Strategy Settings → Competitor Domains, then generate a strategy.</p>
          </div>
        </div>
      </SectionCard>
    );
  }

  if (loading) {
    return (
      <SectionCard>
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
          <p className="text-sm text-zinc-400">Fetching competitive intelligence...</p>
          <p className="text-[11px] text-zinc-500">Comparing domain metrics, keywords, and backlinks</p>
        </div>
      </SectionCard>
    );
  }

  if (error) {
    return (
      <SectionCard>
        <div className="text-center py-6">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={fetchIntel} className="mt-2 text-xs text-teal-400 hover:underline">Retry</button>
        </div>
      </SectionCard>
    );
  }

  if (!data) return null;

  const myDomain = data.domains.find(d => d.isOwn);
  const compDomains = data.domains.filter(d => !d.isOwn);

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-teal-400" />
          <h3 className="text-sm font-semibold text-zinc-200">Competitive Intelligence</h3>
        </div>
        <button onClick={fetchIntel} className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
          Refresh
        </button>
      </div>

      {/* Domain Overview Cards */}
      {myDomain?.overview && (
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Your Organic Traffic" value={fmtNum(myDomain.overview.organicTraffic)} icon={TrendingUp} iconColor="text-teal-400" />
          <StatCard label="Your Keywords" value={fmtNum(myDomain.overview.organicKeywords)} icon={Search} iconColor="text-teal-400" />
          <StatCard label="Your Backlinks" value={fmtNum(myDomain.backlinks?.totalBacklinks || 0)} icon={Link2} iconColor="text-teal-400" />
          <StatCard label="Traffic Value" value={`$${fmtNum(myDomain.overview.organicCost)}`} icon={DollarSign} iconColor="text-teal-400" />
        </div>
      )}

      {/* Competitor Comparison */}
      {compDomains.map(comp => {
        const isExpanded = expanded.has(comp.domain);
        const myOv = myDomain?.overview;
        const compOv = comp.overview;

        return (
          <div key={comp.domain} className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
            <button
              onClick={() => toggleExpand(comp.domain)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-zinc-800/50 transition-colors"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
              <Globe className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-medium text-zinc-200 flex-1 text-left">{comp.domain}</span>
              {compOv && (
                <div className="flex items-center gap-4 text-[11px] text-zinc-500">
                  <span>{fmtNum(compOv.organicTraffic)} traffic</span>
                  <span>{fmtNum(compOv.organicKeywords)} keywords</span>
                  <span>{fmtNum(comp.backlinks?.referringDomains || 0)} ref. domains</span>
                </div>
              )}
            </button>

            {isExpanded && myOv && compOv && (
              <div className="px-4 pb-4 space-y-4 border-t border-zinc-800 pt-3">
                {/* Side-by-side bars */}
                <div className="flex items-center gap-6 text-[11px] mb-2">
                  <span className="text-teal-400 font-medium">{myDomain?.domain}</span>
                  <span className="text-zinc-600">vs</span>
                  <span className="text-orange-400 font-medium">{comp.domain}</span>
                </div>
                <div className="space-y-3">
                  <ComparisonBar myVal={myOv.organicTraffic} theirVal={compOv.organicTraffic} label="Organic Traffic" />
                  <ComparisonBar myVal={myOv.organicKeywords} theirVal={compOv.organicKeywords} label="Keywords" />
                  <ComparisonBar myVal={myDomain?.backlinks?.referringDomains || 0} theirVal={comp.backlinks?.referringDomains || 0} label="Referring Domains" />
                  <ComparisonBar myVal={myOv.organicCost} theirVal={compOv.organicCost} label="Traffic Value ($)" />
                </div>

                {/* Competitor's top keywords */}
                {comp.topKeywords.length > 0 && (
                  <div>
                    <h5 className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Their Top Keywords</h5>
                    <div className="space-y-1">
                      {comp.topKeywords.slice(0, 10).map((kw, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 bg-zinc-950/50 rounded-lg">
                          <span className="text-zinc-500 w-5 text-right font-mono">#{kw.position}</span>
                          <span className="flex-1 text-zinc-300 truncate">{kw.keyword}</span>
                          <span className="text-zinc-500 font-mono">{fmtNum(kw.volume)}/mo</span>
                          <span className={`font-mono ${difficultyColor(kw.difficulty)}`}>KD {kw.difficulty}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Keyword Gaps */}
      {data.keywordGaps.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <button
            onClick={() => toggleExpand('gaps')}
            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-zinc-800/50 transition-colors"
          >
            {expanded.has('gaps') ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
            <Target className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium text-zinc-200 flex-1 text-left">Keyword Gaps</span>
            <span className="text-[11px] text-zinc-500">{data.keywordGaps.length} opportunities</span>
          </button>
          {expanded.has('gaps') && (
            <div className="px-4 pb-4 border-t border-zinc-800 pt-3">
              <p className="text-[11px] text-zinc-500 mb-3">Keywords your competitors rank for that you don't — sorted by traffic potential.</p>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {data.keywordGaps.map((gap, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 bg-zinc-950/50 rounded-lg">
                    <span className="flex-1 text-zinc-300 truncate">{gap.keyword}</span>
                    <span className="text-zinc-500 font-mono">{fmtNum(gap.volume)}/mo</span>
                    <span className={`font-mono ${difficultyColor(gap.difficulty)}`}>KD {gap.difficulty}%</span>
                    <span className="text-orange-400/80 text-[11px]">{gap.competitorDomain} #{gap.competitorPosition}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-zinc-600 text-right">
        Data via SEMRush · Cached 48h · {data.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : ''}
      </p>
    </div>
  );
}
