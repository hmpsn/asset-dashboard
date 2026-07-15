// @ds-rebuilt
import { Icon, Meter, SectionCard, Skeleton } from '../ui';
import type { CompetitiveIntelResponse } from './types';

interface ShareOfVoiceProps {
  data?: CompetitiveIntelResponse;
  isLoading: boolean;
}

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
  const maxShare = sov[0]?.pct ?? 100;

  return (
    <section aria-labelledby="share-of-voice-title">
      <h2 id="share-of-voice-title" className="sr-only" aria-label="Share of voice" />
      <SectionCard
        title="Share of voice"
        subtitle="Organic traffic vs. your competitor set"
        titleIcon={<Icon name="chart" size="sm" className="text-[var(--blue)]" />}
        iconChip
        noPadding
        variant="subtle"
      >
        <div className="px-[18px] py-4">
          {sov.map((row, index) => (
            <div key={row.domain} className={index === sov.length - 1 ? '' : 'mb-[13px]'}>
              <div className="t-label mb-[5px] flex items-baseline justify-between gap-3 font-normal normal-case tracking-normal">
                <span
                  className="min-w-0 truncate font-semibold"
                  style={{ color: row.isOwn ? 'var(--blue)' : 'var(--brand-text)' }}
                >
                  {row.isOwn ? `${row.domain} (you)` : row.domain}
                </span>
                <span // stat-primitive-ok: per-row share-of-voice percentage paired with a Meter, not a metric-grid stat
                  className="font-mono tabular-nums"
                  style={{ color: row.isOwn ? 'var(--blue)' : 'var(--brand-text-muted)' }}
                >
                  {row.pct}%
                </span>
              </div>
              <Meter
                value={row.pct}
                max={maxShare}
                height={9}
                color={row.isOwn ? 'var(--blue)' : 'var(--orange)'}
                ariaLabel={`${row.domain} share of voice`}
              />
            </div>
          ))}
        </div>
      </SectionCard>
    </section>
  );
}
