// @ds-rebuilt
import { MetricTile } from '../../ui';
import { formatNumber } from '../globalOpsFormatters';

interface RoadmapMetricStripProps {
  total: number;
  done: number;
  inProgress: number;
  completion: number;
}

export function RoadmapMetricStrip({ total, done, inProgress, completion }: RoadmapMetricStripProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricTile label="Total items" value={formatNumber(total)} />
      <MetricTile label="Completed" value={formatNumber(done)} accent="var(--emerald)" />
      <MetricTile label="In progress" value={formatNumber(inProgress)} accent="var(--amber)" />
      <MetricTile label="Completion" value={`${completion}%`} accent="var(--blue)" />
    </div>
  );
}
