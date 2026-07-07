// @ds-rebuilt
import { DiagnosticReportPage } from '../admin/DiagnosticReport/DiagnosticReportPage';
import { EmptyState, Icon, PageContainer, PageHeader, SectionCard } from '../ui';
import { useDiagnosticsReportState } from './useGlobalOpsSurfaceState';

interface DiagnosticsLensProps {
  workspaceId?: string;
}

export function DiagnosticsLens({ workspaceId }: DiagnosticsLensProps) {
  const { reportId } = useDiagnosticsReportState();

  if (!workspaceId) {
    return (
      <PageContainer width="wide" className="min-h-full">
        <EmptyState
          icon={({ className }) => <Icon name="gauge" className={className} />}
          title="Choose a workspace"
          description="Diagnostics need a workspace-scoped route before reports can load."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="wide" className="min-h-full" gap={false}>
      <div data-testid="diagnostics-rebuilt" data-report-id={reportId ?? ''} className="flex flex-col gap-[var(--section-gap)]">
        <PageHeader
          title="Diagnostics"
          subtitle={reportId ? 'Deep diagnostic report detail.' : 'Deep diagnostic report list and run history.'}
        />
        <SectionCard title={reportId ? 'Report detail' : 'Reports'} noPadding>
          <div className="p-4">
            <DiagnosticReportPage workspaceId={workspaceId} />
          </div>
        </SectionCard>
      </div>
    </PageContainer>
  );
}
