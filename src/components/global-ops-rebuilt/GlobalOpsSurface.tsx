// @ds-rebuilt
import { BusinessLens } from './BusinessLens';
import { DiagnosticsLens } from './DiagnosticsLens';
import { GlobalSettingsLens } from './GlobalSettingsLens';
import { OutcomeWorkspaceLens } from './OutcomeWorkspaceLens';
import { OutcomesBookLens } from './OutcomesBookLens';
import { RequestsLens } from './RequestsLens';
import { RoadmapLens } from './RoadmapLens';
import { WorkspaceSettingsLens } from './WorkspaceSettingsLens';

interface GlobalOpsSurfaceProps {
  workspaceId?: string;
}

export function GlobalSettingsSurface(_props: GlobalOpsSurfaceProps) {
  return <GlobalSettingsLens />;
}

export function WorkspaceSettingsSurface({ workspaceId }: GlobalOpsSurfaceProps) {
  return <WorkspaceSettingsLens workspaceId={workspaceId} />;
}

export function RoadmapSurface(_props: GlobalOpsSurfaceProps) {
  return <RoadmapLens />;
}

export function RevenueBusinessSurface(_props: GlobalOpsSurfaceProps) {
  return <BusinessLens defaultTab="revenue" />;
}

export function AiUsageBusinessSurface(_props: GlobalOpsSurfaceProps) {
  return <BusinessLens defaultTab="ai-usage" />;
}

export function FeatureLibraryBusinessSurface(_props: GlobalOpsSurfaceProps) {
  return <BusinessLens defaultTab="features" />;
}

export function ProspectBusinessSurface(_props: GlobalOpsSurfaceProps) {
  return <BusinessLens defaultTab="prospects" />;
}

export function OutcomesOverviewSurface(_props: GlobalOpsSurfaceProps) {
  return <OutcomesBookLens />;
}

export function OutcomeWorkspaceSurface({ workspaceId }: GlobalOpsSurfaceProps) {
  return <OutcomeWorkspaceLens workspaceId={workspaceId} />;
}

export function DiagnosticsSurface({ workspaceId }: GlobalOpsSurfaceProps) {
  return <DiagnosticsLens workspaceId={workspaceId} />;
}

export function RequestsSurface({ workspaceId }: GlobalOpsSurfaceProps) {
  return <RequestsLens workspaceId={workspaceId} />;
}
