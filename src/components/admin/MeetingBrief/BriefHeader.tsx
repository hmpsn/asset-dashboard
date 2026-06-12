import { RefreshCw } from 'lucide-react';
import { Button } from '../../ui';
import { timeAgo } from '../../../lib/timeAgo';

interface Props {
  generatedAt: string;
  onRegenerate: () => void;
  isGenerating: boolean;
}

export function BriefHeader({ generatedAt, onRegenerate, isGenerating }: Props) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="t-h1 text-[var(--brand-text-bright)]">Meeting Brief</h1>
        <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
          Generated {timeAgo(generatedAt, { style: 'long' })}
        </p>
      </div>
      <Button
        onClick={onRegenerate}
        disabled={isGenerating}
        size="sm"
        variant="secondary"
        className="font-medium rounded-[var(--radius-lg)] border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-border-hover)]"
        title="Regenerate brief"
      >
        <RefreshCw className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} aria-hidden="true" />
        {isGenerating ? 'Generating\u2026' : 'Regenerate'}
      </Button>
    </div>
  );
}
