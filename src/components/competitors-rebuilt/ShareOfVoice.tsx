// @ds-rebuilt
import { Meter, Skeleton } from '../ui';
import type { CompetitiveIntelResponse } from './types';

interface ShareOfVoiceProps {
  data?: CompetitiveIntelResponse;
  isLoading: boolean;
}

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

export function ShareOfVoice({ data, isLoading }: ShareOfVoiceProps) {
  if (isLoading && !data) return <Skeleton className="h-[180px] w-full" />;

  const rows = (data?.domains ?? [])
    .filter((domain) => domain.overview && domain.overview.organicTraffic > 0)
    .map((domain) => ({
      domain: domain.domain,
      isOwn: domain.isOwn,
      traffic: domain.overview!.organicTraffic,
    }));
  const total = rows.reduce((sum, row) => sum + row.traffic, 0);
  const hasOwn = rows.some((row) => row.isOwn);
  if (!hasOwn || rows.length < 2 || total <= 0) return null;

  const sov = rows
    .map((row) => ({ ...row, pct: Math.round((row.traffic / total) * 100) }))
    .sort((a, b) => b.traffic - a.traffic);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="share-of-voice-title">
      <div>
        <h2 id="share-of-voice-title" className="t-ui font-semibold text-[var(--brand-text-bright)]">
          Share of voice
        </h2>
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          Organic traffic share across your domain and configured competitors.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {sov.map((row) => (
          <div
            key={row.domain}
            className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-4 py-3"
          >
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p
                  className="truncate t-caption font-semibold"
                  style={{ color: row.isOwn ? 'var(--blue)' : 'var(--brand-text-bright)' }}
                >
                  {row.isOwn ? `${row.domain} (you)` : row.domain}
                </p>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">
                  {NUMBER_FORMAT.format(row.traffic)} est. visits
                </p>
              </div>
              <span // stat-primitive-ok: per-row share-of-voice percentage in a domain list (paired with a Meter bar), not a labeled StatCard/CompactStatBar metric grid
                className="t-stat-sm tabular-nums font-bold"
                style={{ color: row.isOwn ? 'var(--blue)' : 'var(--orange)' }}
              >
                {row.pct}%
              </span>
            </div>
            <Meter
              value={row.pct}
              color={row.isOwn ? 'var(--blue)' : 'var(--orange)'}
              ariaLabel={`${row.domain} share of voice`}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
