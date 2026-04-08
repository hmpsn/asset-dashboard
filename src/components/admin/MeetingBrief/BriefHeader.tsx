import { RefreshCw } from 'lucide-react';

interface Props {
  generatedAt: string;
  onRegenerate: () => void;
  isGenerating: boolean;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

export function BriefHeader({ generatedAt, onRegenerate, isGenerating }: Props) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Meeting Brief</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Generated {formatRelativeTime(generatedAt)}
        </p>
      </div>
      <button
        onClick={onRegenerate}
        disabled={isGenerating}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        title="Regenerate brief"
      >
        <RefreshCw className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} />
        {isGenerating ? 'Generating\u2026' : 'Regenerate'}
      </button>
    </div>
  );
}
