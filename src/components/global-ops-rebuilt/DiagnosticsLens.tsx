// @ds-rebuilt
import { EmptyState, Icon } from '../ui';
import { useDiagnosticsReportState } from './useGlobalOpsSurfaceState';
import { DiagnosticsWorkspace } from './wave-b/diagnostics/DiagnosticsWorkspace';

interface DiagnosticsLensProps {
  workspaceId?: string;
}

export function DiagnosticsLens({ workspaceId }: DiagnosticsLensProps) {
  const { reportId } = useDiagnosticsReportState();

  if (!workspaceId) {
    return (
      <div className="mx-auto min-h-full w-full max-w-[940px] px-4 pb-[90px] pt-[26px] sm:px-[30px]">
        <EmptyState
          icon={({ className }) => <Icon name="gauge" className={className} />}
          title="Choose a workspace"
          description="Choose a workspace to inspect diagnostic reports and run history."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-full w-full max-w-[940px] px-4 pb-[90px] pt-[26px] sm:px-[30px]">
      <div data-testid="diagnostics-rebuilt" data-report-id={reportId ?? ''} className="w-full">
        <DiagnosticsWorkspace workspaceId={workspaceId} reportId={reportId} />
      </div>
    </div>
  );
}
