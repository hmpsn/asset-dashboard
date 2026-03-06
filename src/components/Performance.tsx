import { useState } from 'react';
import { BarChart3, Gauge } from 'lucide-react';
import { PageWeight } from './PageWeight';
import { PageSpeedPanel } from './PageSpeedPanel';

type PerfTab = 'weight' | 'speed';

export function Performance({ siteId }: { siteId: string }) {
  const [tab, setTab] = useState<PerfTab>('weight');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-zinc-800 pb-0">
        {([
          { id: 'weight' as const, label: 'Page Weight', icon: BarChart3 },
          { id: 'speed' as const, label: 'Page Speed', icon: Gauge },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
              tab === t.id
                ? 'border-teal-500 text-teal-300'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'weight' && <PageWeight siteId={siteId} />}
      {tab === 'speed' && <PageSpeedPanel siteId={siteId} />}
    </div>
  );
}
