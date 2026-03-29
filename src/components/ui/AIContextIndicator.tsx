/**
 * AI Context Indicator — shows how much context is available for AI features.
 * Fetches from /api/ai/context/:workspaceId and displays a compact bar
 * with score, connected count, and expandable details with fix links.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminPath } from '../../routes';
import { get } from '../../api/client';
import {
  Brain,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  Search,
  BarChart3,
  BookOpen,
  MessageSquare,
  Users,
  Map,
  Database,
} from 'lucide-react';

interface ContextSource {
  key: string;
  label: string;
  status: 'connected' | 'missing' | 'partial';
  detail: string;
  impacts: string[];
  fixAction?: string;
}

interface ContextCompleteness {
  workspaceId: string;
  score: number;
  connected: number;
  total: number;
  sources: ContextSource[];
}

const ICON_MAP: Record<string, typeof Globe> = {
  webflow: Globe,
  gsc: Search,
  ga4: BarChart3,
  'knowledge-base': BookOpen,
  'brand-voice': MessageSquare,
  personas: Users,
  'keyword-strategy': Map,
  semrush: Database,
};

interface Props {
  workspaceId: string;
  /** Which tab is requesting context — filters to show only relevant sources */
  feature?: 'strategy' | 'briefs' | 'posts' | 'chat' | 'internal-links' | 'all';
  /** Compact mode: just the score pill, no expand */
  compact?: boolean;
}

export function AIContextIndicator({ workspaceId, feature = 'all', compact = false }: Props) {
  const navigate = useNavigate();
  const [data, setData] = useState<ContextCompleteness | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    get<ContextCompleteness>(`/api/ai/context/${workspaceId}`)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  if (!data) return null;

  // Filter sources by feature relevance
  const sources = feature === 'all'
    ? data.sources
    : data.sources.filter(s => s.impacts.includes(feature));

  const connected = sources.filter(s => s.status === 'connected').length;
  const total = sources.length;
  const missing = sources.filter(s => s.status === 'missing');
  const score = total > 0 ? Math.round((connected / total) * 100) : 0;
  const allConnected = missing.length === 0;

  // Color based on completeness
  const colorClass = allConnected
    ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5'
    : score >= 60
      ? 'text-amber-400/80 border-amber-500/30 bg-amber-500/5'
      : 'text-red-400/80 border-red-500/30 bg-red-500/5';

  const pillColor = allConnected
    ? 'bg-emerald-500/15 text-emerald-400'
    : score >= 60
      ? 'bg-amber-500/15 text-amber-400/80'
      : 'bg-red-500/15 text-red-400/80';

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${pillColor}`} title={`AI Context: ${connected}/${total} sources connected`}>
        <Brain className="w-3 h-3" />
        {connected}/{total}
      </span>
    );
  }

  return (
    <div className={`rounded-lg border ${colorClass} transition-all`}>
      {/* Header bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Brain className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="text-[12px] font-medium">
            AI Context: {connected}/{total} sources
          </span>
          {!allConnected && (
            <span className="text-[11px] opacity-70">
              — {missing.length === 1
                ? `${missing[0].label} missing`
                : `${missing.length} sources missing`}
            </span>
          )}
          {allConnected && (
            <span className="text-[11px] opacity-70">— all connected</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${pillColor}`}>
            {score}%
          </span>
          {expanded
            ? <ChevronUp className="w-3 h-3 opacity-50" />
            : <ChevronDown className="w-3 h-3 opacity-50" />
          }
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-1.5 border-t border-zinc-800/50">
          {sources.map(source => {
            const Icon = ICON_MAP[source.key] || BookOpen;
            const isConnected = source.status === 'connected';
            return (
              <div
                key={source.key}
                className={`flex items-start gap-2 py-1.5 ${isConnected ? 'opacity-60' : ''}`}
              >
                {isConnected
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                  : <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                }
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3 h-3 flex-shrink-0" />
                    <span className="text-[12px] font-medium text-zinc-200">{source.label}</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5">{source.detail}</p>
                </div>
                {!isConnected && source.fixAction && (
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(adminPath(workspaceId, source.fixAction! as import('../../routes').Page)); }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors flex-shrink-0"
                  >
                    Set up <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
