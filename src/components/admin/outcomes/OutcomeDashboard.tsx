import { useState, lazy, Suspense } from 'react';
import { PageHeader, TabBar, Skeleton } from '../../ui';
import { ErrorBoundary } from '../../ErrorBoundary';
import RecordPublishedWorkCard from './RecordPublishedWorkCard';

// Lazy load sub-panels
const OutcomeScorecard = lazy(() => import('./OutcomeScorecard'));
const OutcomeActionFeed = lazy(() => import('./OutcomeActionFeed'));
const OutcomeTopWins = lazy(() => import('./OutcomeTopWins'));
const OutcomeLearningsPanel = lazy(() => import('./OutcomeLearningsPanel'));
const OutcomePlaybooks = lazy(() => import('./OutcomePlaybooks'));
// R9 (B15): admin-only coverage funnel — see OutcomeCoverageFunnel.tsx header comment.
const OutcomeCoverageFunnel = lazy(() => import('./OutcomeCoverageFunnel'));

type OutcomeTab = 'scorecard' | 'actions' | 'wins' | 'learnings' | 'playbooks' | 'coverage';

interface OutcomeDashboardProps {
  workspaceId: string;
}

export default function OutcomeDashboard({ workspaceId }: OutcomeDashboardProps) {
  const [activeTab, setActiveTab] = useState<OutcomeTab>('wins');

  const tabs = [
    { id: 'wins', label: 'Top Wins' },
    { id: 'scorecard', label: 'Scorecard' },
    { id: 'playbooks', label: 'Playbooks' },
    { id: 'actions', label: 'Actions' },
    { id: 'learnings', label: 'Learnings' },
    // R9 (B15): admin-only diagnostic tab — never surfaced client-side.
    { id: 'coverage', label: 'Coverage' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outcomes"
        subtitle="Track what's working across all your SEO actions"
      />
      <RecordPublishedWorkCard workspaceId={workspaceId} />
      {/* tab-deeplink-ok — outcomes tabs are not navigated to via ?tab= from other components */}
      <TabBar tabs={tabs} active={activeTab} onChange={(t) => setActiveTab(t as OutcomeTab)} />
      <ErrorBoundary>
        <Suspense fallback={<Skeleton className="h-64" />}>
          {activeTab === 'scorecard' && <OutcomeScorecard workspaceId={workspaceId} />}
          {activeTab === 'actions' && <OutcomeActionFeed workspaceId={workspaceId} />}
          {activeTab === 'wins' && <OutcomeTopWins workspaceId={workspaceId} />}
          {activeTab === 'learnings' && <OutcomeLearningsPanel workspaceId={workspaceId} />}
          {activeTab === 'playbooks' && <OutcomePlaybooks workspaceId={workspaceId} />}
          {activeTab === 'coverage' && <OutcomeCoverageFunnel workspaceId={workspaceId} />}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
