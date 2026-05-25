import { ArrowUpRight } from 'lucide-react';
import { Button } from '../../ui';

interface Props {
  progress: string | null;
  onOpenBlueprint?: () => void;
}

export function BlueprintProgress({ progress, onOpenBlueprint }: Props) {
  if (!progress) return null;
  return (
    <div className="mb-6">
      <h3 className="t-caption-sm font-semibold uppercase tracking-wider text-[var(--brand-text-muted)] mb-3">
        Blueprint Progress
      </h3>
      <p className="t-caption-sm text-[var(--brand-text-bright)] leading-relaxed">{progress}</p>
      {onOpenBlueprint && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 px-2 py-1 t-caption-sm text-accent-brand"
          icon={ArrowUpRight}
          onClick={onOpenBlueprint}
        >
          Open blueprint
        </Button>
      )}
    </div>
  );
}
