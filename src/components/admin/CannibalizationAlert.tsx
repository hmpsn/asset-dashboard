import { AlertTriangle } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { TierGate } from '../ui/TierGate';
import type { CannibalizationWarning } from '../../../shared/types/intelligence';

interface Props {
  warnings: CannibalizationWarning[] | null | undefined;
  tier: 'free' | 'growth' | 'premium';
}

const SEVERITY_CLASSES: Record<CannibalizationWarning['severity'], string> = {
  high: 'text-red-400 bg-red-500/10 border-red-500/20',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  low: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
};

const SEVERITY_ICON_COLOR: Record<CannibalizationWarning['severity'], string> = {
  high: 'text-red-400',
  medium: 'text-amber-400',
  low: 'text-blue-400',
};

/** Strip protocol + domain from a URL, leaving only the path. Falls back to the original string if not a valid URL. */
function toPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    // Already a path or malformed — return as-is
    return url;
  }
}

export function CannibalizationAlert({ warnings, tier }: Props) {
  if (!warnings || warnings.length === 0) return null;

  return (
    <TierGate
      tier={tier}
      required="growth"
      feature="Keyword Cannibalization Alerts"
    >
      <SectionCard title="Keyword Cannibalization Detected">
        <div className="space-y-3">
          {warnings.map((w) => (
            <div
              key={w.keyword}
              className={`border rounded-lg p-3 ${SEVERITY_CLASSES[w.severity]}`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${SEVERITY_ICON_COLOR[w.severity]}`} />
                <span>
                  &ldquo;{w.keyword}&rdquo; targeted by {w.pages.length} pages
                </span>
              </div>
              <div className="mt-2 ml-6 space-y-0.5">
                {w.pages.map((page) => (
                  <div key={page} className="text-xs text-zinc-400 truncate">
                    {toPath(page)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </TierGate>
  );
}
