interface WeeklySummary {
  seoUpdates: number;
  auditsRun: number;
  contentGenerated: number;
  contentPublished: number;
  requestsResolved: number;
}

interface WeeklyAccomplishmentsProps {
  summary: WeeklySummary;
}

export function WeeklyAccomplishments({ summary }: WeeklyAccomplishmentsProps) {
  const items: { label: string; value: number }[] = [
    { label: 'SEO update', value: summary.seoUpdates },
    { label: 'audit', value: summary.auditsRun },
    { label: 'brief', value: summary.contentGenerated },
    { label: 'published', value: summary.contentPublished },
    { label: 'request resolved', value: summary.requestsResolved },
  ].filter(i => i.value > 0);

  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px] text-zinc-500">
      <span className="text-zinc-400 font-medium">This week:</span>
      {items.map((item, i) => (
        <span key={item.label} className="flex items-center gap-1">
          {i > 0 && <span className="text-zinc-700">·</span>}
          <span className="inline-flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 font-medium tabular-nums">{item.value}</span>
            {item.label}{item.value !== 1 && item.label !== 'published' ? 's' : ''}
          </span>
        </span>
      ))}
    </div>
  );
}
