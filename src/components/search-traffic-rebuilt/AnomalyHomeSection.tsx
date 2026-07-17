// @ds-rebuilt
import { useEffect, useRef } from 'react';
import { useAnomalyAlerts } from '../../hooks/admin/useAnomalyAlerts';
import { AnomalyAlerts } from '../AnomalyAlerts';
import { Badge, Icon, InlineBanner, SectionCard, Skeleton } from '../ui';

interface AnomalyHomeSectionProps {
  workspaceId: string;
  focused?: boolean;
}

export function AnomalyHomeSection({ workspaceId, focused = false }: AnomalyHomeSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const { data: anomalies = [], isLoading } = useAnomalyAlerts(workspaceId, true);
  const criticalCount = anomalies.filter((anomaly) => anomaly.severity === 'critical').length;
  const warningCount = anomalies.filter((anomaly) => anomaly.severity === 'warning').length;
  const positiveCount = anomalies.filter((anomaly) => anomaly.severity === 'positive').length;

  useEffect(() => {
    if (!focused) return;
    sectionRef.current?.scrollIntoView?.({ block: 'start' });
    sectionRef.current?.focus({ preventScroll: true });
  }, [focused]);

  return (
    <section
      ref={sectionRef}
      id="anomalies"
      role="region"
      aria-label="Anomalies"
      tabIndex={-1}
      className="scroll-mt-[var(--space-8)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)]"
    >
      <SectionCard
        title="Anomalies"
        subtitle="Provider changes, investigation narratives, and review state from the active anomaly stream."
        titleIcon={<Icon name="bell" size="md" className="text-[var(--blue)]" aria-hidden="true" />}
        iconChip
        action={<Badge label={`${anomalies.length} anomalies`} tone="blue" variant="soft" size="sm" />}
      >
        {anomalies.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Anomaly severity counts">
            {criticalCount > 0 && <Badge label={`${criticalCount} critical`} tone="red" variant="soft" size="sm" />}
            {warningCount > 0 && <Badge label={`${warningCount} warning`} tone="amber" variant="soft" size="sm" />}
            {positiveCount > 0 && <Badge label={`${positiveCount} positive`} tone="emerald" variant="soft" size="sm" />}
          </div>
        )}
        {isLoading && anomalies.length === 0 ? (
          <div className="flex flex-col gap-2" aria-label="Loading anomalies">
            <Skeleton className="h-[62px] w-full" />
            <Skeleton className="h-[62px] w-full" />
          </div>
        ) : anomalies.length === 0 ? (
          <InlineBanner
            tone="success"
            title="No active anomalies"
            message="The latest provider comparisons have no undismissed changes to review."
          />
        ) : (
          <AnomalyAlerts workspaceId={workspaceId} isAdmin />
        )}
      </SectionCard>
    </section>
  );
}
