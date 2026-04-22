import { useMemo } from 'react';
import type { RoadmapItem } from '../../shared/types/roadmap';
import { chartGridColor, chartDotFill } from './ui/constants';
import { SectionCard } from './ui/index';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonth(m: string): string {
  const [, mo] = m.split('-');
  return MONTH_NAMES[parseInt(mo, 10) - 1] || mo;
}

export function ShippingVelocityChart({ items }: { items: RoadmapItem[] }) {
  const data = useMemo(() => {
    const shipped = items.filter(i => i.status === 'done' && i.shippedAt);
    const byMonth: Record<string, number> = {};
    shipped.forEach(i => {
      const key = i.shippedAt!.slice(0, 7);
      byMonth[key] = (byMonth[key] || 0) + 1;
    });
    const sorted = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.reduce<Array<{ month: string; count: number; cumulative: number }>>((acc, [month, count]) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].cumulative : 0;
      acc.push({ month, count, cumulative: prev + count });
      return acc;
    }, []);
  }, [items]);

  if (data.length < 2) return null;

  const W = 600, H = 180, PAD_L = 40, PAD_R = 20, PAD_T = 20, PAD_B = 32;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const maxY = Math.max(...data.map(d => d.cumulative));
  const xStep = chartW / (data.length - 1);

  const points = data.map((d, i) => ({
    x: PAD_L + i * xStep,
    y: PAD_T + chartH - (d.cumulative / maxY) * chartH,
    ...d,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${PAD_T + chartH} L${points[0].x},${PAD_T + chartH} Z`;

  return (
    <SectionCard
      title="Shipping Velocity"
      action={<span className="text-[11px] text-zinc-500">{data[data.length - 1].cumulative} features shipped</span>}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
        <defs>
          <linearGradient id="vel-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const y = PAD_T + chartH - f * chartH;
          return (
            <g key={f}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={chartGridColor()} strokeWidth="1" />
              <text x={PAD_L - 6} y={y + 3} textAnchor="end" className="fill-zinc-600" fontSize="10">
                {Math.round(f * maxY)}
              </text>
            </g>
          );
        })}
        <path d={areaPath} fill="url(#vel-grad)" />
        <path d={linePath} fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3.5" fill={chartDotFill()} stroke="#2dd4bf" strokeWidth="2" />
            <text x={p.x} y={p.y - 8} textAnchor="middle" className="fill-teal-400" fontSize="10" fontWeight="600">
              +{p.count}
            </text>
            <text x={p.x} y={PAD_T + chartH + 16} textAnchor="middle" className="fill-zinc-500" fontSize="10">
              {formatMonth(p.month)}
            </text>
          </g>
        ))}
      </svg>
    </SectionCard>
  );
}
