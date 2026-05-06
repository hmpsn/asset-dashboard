import { Check, Plus } from 'lucide-react';

interface Props {
  keyword: string;
  trackedKeywords: Set<string>;
  onTrackKeyword: (keyword: string) => void;
}

export function PageIntelligenceTrackKeywordButton({
  keyword,
  trackedKeywords,
  onTrackKeyword,
}: Props) {
  const isTracked = trackedKeywords.has(keyword);

  return (
    <button
      onClick={() => onTrackKeyword(keyword)}
      title={isTracked ? 'Tracking' : 'Track in Rank Tracker'}
      className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${ // arbitrary-text-ok
        isTracked ? 'border-emerald-500/30 bg-emerald-500/10 text-accent-success' : 'border-teal-500/30 bg-teal-500/10 text-accent-brand hover:bg-teal-500/20'}`}
    >
      {isTracked ? <><Check className="w-2.5 h-2.5" /> Tracking</> : <><Plus className="w-2.5 h-2.5" /> Track</>}
    </button>
  );
}
