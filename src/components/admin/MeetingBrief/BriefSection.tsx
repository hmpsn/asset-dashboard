interface Props {
  title: string;
  items: string[];
  className?: string;
}

export function BriefSection({ title, items, className = '' }: Props) {
  if (items.length === 0) return null;
  return (
    <div className={`mb-6 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">{title}</h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-zinc-200 leading-relaxed">
            <span className="mt-1.5 shrink-0 w-1 h-1 rounded-full bg-zinc-500" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
