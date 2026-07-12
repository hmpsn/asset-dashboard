// @ds-rebuilt
import { DiagnosticsListView } from './DiagnosticsListView';
import { DiagnosticsReportView } from './DiagnosticsReportView';

interface DiagnosticsWorkspaceProps {
  workspaceId: string;
  reportId: string | null;
}

export function DiagnosticsWorkspace({ workspaceId, reportId }: DiagnosticsWorkspaceProps) {
  return reportId
    ? <DiagnosticsReportView workspaceId={workspaceId} reportId={reportId} />
    : <DiagnosticsListView workspaceId={workspaceId} />;
}
