import { useState, lazy, Suspense } from 'react';
import { PageHeader, TabBar, Skeleton } from '../../ui';
import { FeatureFlag } from '../../ui/FeatureFlag';
import { ErrorBoundary } from '../../ErrorBoundary';

// Lazy load sub-panels
const OutcomeScorecard = lazy(() => import('./OutcomeScorecard'));
const OutcomeActionFeed = lazy(() => import('./OutcomeActionFeed'));
const OutcomeTopWins = lazy(() => import('./OutcomeTopWins'));
const OutcomeLearningsPanel = lazy(() => import('./OutcomeLearningsPanel'));
const OutcomePlaybooks = lazy(() => import('./OutcomePlaybooks'));

type OutcomeTab = 'scorecard' | 'actions' | 'wins' | 'learnings' | 'playbooks';

interface OutcomeDashboardProps {
  workspaceId: string;
}

export default function OutcomeDashboard({ workspaceId }: OutcomeDashboardProps) {
  const [activeTab, setActiveTab] = useState<OutcomeTab>('scorecard');

  const tabs = [
    { id: 'scorecard', label: 'Scorecard' },
    { id: 'actions', label: 'Actions' },
    { id: 'wins', label: 'Top Wins' },
    { id: 'learnings', label: 'Learnings' },
    { id: 'playbooks', label: 'Playbooks' },
  ];

  return (
    <FeatureFlag flag="outcome-dashboard">
      <div className="space-y-6">
        <PageHeader
          title="Outcomes"
          subtitle="Track what's working across all your SEO actions"
        />
        <TabBar tabs={tabs} active={activeTab} onChange={(t) => setActiveTab(t as OutcomeTab)} />
        <ErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64" />}>
            {activeTab === 'scorecard' && <OutcomeScorecard workspaceId={workspaceId} />}
            {activeTab === 'actions' && <OutcomeActionFeed workspaceId={workspaceId} />}
            {activeTab === 'wins' && <OutcomeTopWins workspaceId={workspaceId} />}
            {activeTab === 'learnings' && <OutcomeLearningsPanel workspaceId={workspaceId} />}
            {activeTab === 'playbooks' && <OutcomePlaybooks workspaceId={workspaceId} />}
          </Suspense>
        </ErrorBoundary>
      </div>
    </FeatureFlag>
  );
}
