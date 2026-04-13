import { SectionCard } from './SectionCard';

export interface HealthMetric {
  label: string;
  percent: number;
  onClick?: () => void;
}

export interface WorkspaceHealthBarProps {
  metrics: HealthMetric[];
  recommendations?: { label: string; onClick: () => void; estimatedTime?: string }[];
}

export function WorkspaceHealthBar({ metrics, recommendations }: WorkspaceHealthBarProps) {
  const hasRecommendations = recommendations && recommendations.length > 0;

  return (
    <SectionCard title="Workspace Health">
      <div className="space-y-3">
        {metrics.map((metric) => (
          <button
            key={metric.label}
            type="button"
            className={`w-full text-left ${metric.onClick ? 'cursor-pointer group' : 'cursor-default'}`}
            onClick={metric.onClick}
            disabled={!metric.onClick}
            aria-label={`${metric.label}: ${Math.min(100, Math.max(0, metric.percent))}%`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-medium text-zinc-400 ${metric.onClick ? 'group-hover:text-zinc-200 transition-colors duration-150' : ''}`}>
                {metric.label}
              </span>
              <span className="text-xs text-zinc-500 tabular-nums">{Math.min(100, Math.max(0, metric.percent))}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-500 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, metric.percent))}%` }}
                aria-valuenow={Math.min(100, Math.max(0, metric.percent))}
                aria-valuemin={0}
                aria-valuemax={100}
                role="progressbar"
                aria-label={metric.label}
              />
            </div>
          </button>
        ))}
      </div>

      {hasRecommendations && (
        <div className="mt-4 pt-4 border-t border-zinc-800">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            Recommended Next
          </p>
          <ul className="space-y-1.5">
            {recommendations.map((rec, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={rec.onClick}
                  className="flex items-center gap-2 w-full text-left text-sm text-zinc-300 hover:text-teal-400 transition-colors duration-150 group"
                >
                  <span className="text-teal-500 group-hover:text-teal-400 transition-colors duration-150 flex-shrink-0" aria-hidden="true">
                    &rarr;
                  </span>
                  <span className="flex-1 min-w-0 truncate">{rec.label}</span>
                  {rec.estimatedTime && (
                    <span className="text-xs text-zinc-600 flex-shrink-0">~{rec.estimatedTime}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
