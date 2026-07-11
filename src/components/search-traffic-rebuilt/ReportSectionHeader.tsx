// @ds-rebuilt
interface ReportSectionHeaderProps {
  number: string;
  title: string;
  description?: string;
}

export function ReportSectionHeader({ number, title, description }: ReportSectionHeaderProps) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="t-micro font-semibold tracking-[0.16em] text-[var(--blue)]">{number}</span>
      <div className="min-w-0">
        <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">{title}</h3>
        {description && <p className="t-caption-sm text-[var(--brand-text-muted)]">{description}</p>}
      </div>
      <span className="h-px min-w-8 flex-1 bg-[var(--brand-border)]" aria-hidden="true" />
    </div>
  );
}
