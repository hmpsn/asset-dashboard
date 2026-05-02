interface Props {
  title: string;
  items: string[];
  className?: string;
}

export function BriefSection({ title, items, className = '' }: Props) {
  if (items.length === 0) return null;
  return (
    <div className={`mb-6 ${className}`}>
      <h3 className="t-caption-sm font-semibold uppercase tracking-wider text-[var(--brand-text-muted)] mb-3">{title}</h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 t-caption-sm text-[var(--brand-text-bright)] leading-relaxed">
            <span className="mt-1.5 shrink-0 w-1 h-1 rounded-[var(--radius-pill)] bg-[var(--brand-text-muted)]" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
