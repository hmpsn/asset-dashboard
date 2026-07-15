// @ds-rebuilt
import { DataTable, DefinitionList, Drawer, type DataColumn } from '../ui';
import type { CompetitiveDomain } from './types';

interface CompetitorDetailDrawerProps {
  domains: CompetitiveDomain[];
  selectedDomain: string | null;
  onClose: () => void;
}

type KeywordRecord = Record<string, unknown> & {
  keyword: string;
  position: number;
  volume: number;
  difficulty: number;
  traffic: number;
};

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const keywordColumns: DataColumn[] = [
  { key: 'keyword', label: 'Keyword', width: 'minmax(220px, 1.5fr)', sortable: true },
  { key: 'position', label: 'Pos.', width: '72px', align: 'right', render: (value) => `#${value}`, sortable: true },
  { key: 'volume', label: 'Vol.', width: '88px', align: 'right', render: (value) => NUMBER_FORMAT.format(Number(value ?? 0)), sortable: true },
  { key: 'difficulty', label: 'KD', width: '72px', align: 'right', render: (value) => `${value}%`, sortable: true },
  { key: 'traffic', label: 'Traffic', width: '92px', align: 'right', render: (value) => NUMBER_FORMAT.format(Number(value ?? 0)), sortable: true },
];

function num(value: number | null | undefined): string {
  return typeof value === 'number' ? NUMBER_FORMAT.format(value) : '-';
}

function money(value: number | null | undefined): string {
  return typeof value === 'number' ? MONEY_FORMAT.format(value) : '-';
}

function comparisonPct(a: number, b: number): number {
  const total = a + b;
  if (total <= 0) return 50;
  return Math.round((a / total) * 100);
}

function ComparisonRow({ label, own, competitor }: { label: string; own: number; competitor: number }) {
  const ownPct = comparisonPct(own, competitor);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 t-caption-sm">
        <span className="tabular-nums font-semibold text-[var(--blue)]">{num(own)}</span>
        <span className="text-[var(--brand-text-muted)]">{label}</span>
        <span className="tabular-nums font-semibold text-[var(--orange)]">{num(competitor)}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--surface-1)]">
        <div className="h-full bg-[var(--blue)]" style={{ width: `${ownPct}%` }} />
        <div className="h-full bg-[var(--orange)]" style={{ width: `${100 - ownPct}%` }} />
      </div>
    </div>
  );
}

export function CompetitorDetailDrawer({ domains, selectedDomain, onClose }: CompetitorDetailDrawerProps) {
  const own = domains.find((domain) => domain.isOwn);
  const competitor = domains.find((domain) => domain.domain === selectedDomain);
  const rows: KeywordRecord[] = (competitor?.topKeywords ?? []).slice(0, 10).map((keyword) => ({
    keyword: keyword.keyword,
    position: keyword.position,
    volume: keyword.volume,
    difficulty: keyword.difficulty,
    traffic: keyword.traffic,
  }));

  return (
    <Drawer
      open={Boolean(competitor)}
      onClose={onClose}
      title={competitor?.domain ?? 'Competitor'}
      subtitle="Domain comparison and top keyword evidence."
      width={560}
    >
      {competitor && (
        <div className="flex flex-col gap-5 p-5">
          {own && (
            <div className="flex flex-col gap-3">
              <ComparisonRow
                label="Organic traffic"
                own={own.overview?.organicTraffic ?? 0}
                competitor={competitor.overview?.organicTraffic ?? 0}
              />
              <ComparisonRow
                label="Organic keywords"
                own={own.overview?.organicKeywords ?? 0}
                competitor={competitor.overview?.organicKeywords ?? 0}
              />
              <ComparisonRow
                label="Ref. domains"
                own={own.backlinks?.referringDomains ?? 0}
                competitor={competitor.backlinks?.referringDomains ?? 0}
              />
              <ComparisonRow
                label="Traffic value"
                own={own.overview?.organicCost ?? 0}
                competitor={competitor.overview?.organicCost ?? 0}
              />
            </div>
          )}

          <DefinitionList
            items={[
              { label: 'Organic traffic', value: num(competitor.overview?.organicTraffic) },
              { label: 'Organic keywords', value: num(competitor.overview?.organicKeywords) },
              { label: 'Traffic value', value: money(competitor.overview?.organicCost) },
              { label: 'Referring domains', value: num(competitor.backlinks?.referringDomains) },
              ...(competitor.authorityRank != null ? [{ label: 'Authority', value: `${competitor.authorityRank}/100` }] : []),
              ...(competitor.top3Keywords != null ? [{ label: 'Top-3 keywords', value: num(competitor.top3Keywords) }] : []),
            ]}
          />

          <div className="flex flex-col gap-2">
            <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Top keyword evidence</h3>
            <DataTable
              columns={keywordColumns}
              rows={rows}
              getRowKey={(row) => (row as KeywordRecord).keyword}
            />
          </div>
        </div>
      )}
    </Drawer>
  );
}
