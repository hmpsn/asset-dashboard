// @ds-rebuilt
import { useEffect, useState } from 'react';
import { AIUsageSection } from '../AIUsageSection';
import FeatureLibrary from '../FeatureLibrary';
import { RevenueDashboard } from '../RevenueDashboard';
import { SalesReport } from '../SalesReport';
import { useCreateWorkspace } from '../../hooks/admin/useWorkspaces';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  FormInput,
  Icon,
  InlineBanner,
  PageContainer,
  PageHeader,
  Segmented,
  SectionCard,
} from '../ui';
import { mutationErrorMessage } from './globalOpsMutationFeedback';
import {
  BUSINESS_TABS,
  useBusinessTabState,
  type BusinessTab,
} from './useGlobalOpsSurfaceState';

interface BusinessLensProps {
  defaultTab?: BusinessTab;
}

const TAB_LABELS: Record<BusinessTab, string> = {
  revenue: 'Revenue',
  'ai-usage': 'AI Usage',
  features: 'Features',
  prospects: 'Prospects',
};

function domainFromUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim();
}

function titleFromDomain(domain: string): string {
  const first = domain.split('.')[0] || 'New Workspace';
  return first
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'New Workspace';
}

function readProspectHash(): string {
  if (typeof window === 'undefined') return '';
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash.startsWith('new-workspace')) return '';
  const [, query = ''] = hash.split('?');
  const params = new URLSearchParams(query);
  return params.get('url') ?? '';
}

export function BusinessLens({ defaultTab }: BusinessLensProps) {
  const { toast } = useToast();
  const state = useBusinessTabState(defaultTab);
  const { tab, invalidTab, setTab } = state;
  const createWorkspace = useCreateWorkspace();
  const [prospectUrl, setProspectUrl] = useState(() => readProspectHash());
  const [workspaceName, setWorkspaceName] = useState(() => {
    const domain = domainFromUrl(readProspectHash());
    return domain ? titleFromDomain(domain) : '';
  });

  useEffect(() => {
    const handleHash = () => {
      const nextUrl = readProspectHash();
      if (!nextUrl) return;
      setProspectUrl(nextUrl);
      setWorkspaceName(titleFromDomain(domainFromUrl(nextUrl)));
      setTab('prospects');
    };
    window.addEventListener('hashchange', handleHash);
    handleHash();
    return () => window.removeEventListener('hashchange', handleHash);
  }, [setTab]);

  const createFromProspect = () => {
    const name = workspaceName.trim() || titleFromDomain(domainFromUrl(prospectUrl));
    if (!name) return;
    createWorkspace.mutate({ name }, {
      onSuccess: () => {
        toast('Workspace created from prospect', 'success');
        if (typeof window !== 'undefined') window.location.hash = '';
        setProspectUrl('');
      },
      onError: (error) => toast(mutationErrorMessage(error, 'Workspace creation failed'), 'error'),
    });
  };

  const activeContent = tab === 'revenue'
    ? <RevenueDashboard />
    : tab === 'ai-usage'
      ? <AIUsageSection />
      : tab === 'features'
        ? <FeatureLibrary />
        : <SalesReport />;

  return (
    <PageContainer width="wide" className="min-h-full" gap={false}>
      <div data-testid="business-rebuilt" data-active-tab={tab} className="flex flex-col gap-[var(--section-gap)]">
        <PageHeader
          title="Business"
          subtitle="Revenue, AI cost, feature catalog, and prospect audit operations."
          actions={<Badge label="Additive aliases" tone="blue" variant="soft" />}
        />

        {invalidTab && (
          <InlineBanner
            tone="warning"
            title="Unknown Business tab"
            message={`The requested tab is not active, so Business opened ${TAB_LABELS[tab]}.`}
            data-testid="business-invalid-tab-fallback"
          />
        )}

        <Segmented
          options={BUSINESS_TABS.map((tab) => ({ value: tab, label: TAB_LABELS[tab] }))}
          value={tab}
          onChange={(value) => setTab(value as BusinessTab)}
          className="max-w-full overflow-x-auto"
        />

        {tab === 'prospects' && prospectUrl && (
          <SectionCard
            title="Create workspace from prospect"
            titleIcon={<Icon name="plus" size="md" className="text-[var(--teal)]" />}
            titleExtra={<Badge label={domainFromUrl(prospectUrl)} tone="blue" variant="soft" />}
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <FormInput value={workspaceName} onChange={setWorkspaceName} placeholder="Workspace name" className="flex-1" />
              <Button onClick={createFromProspect} loading={createWorkspace.isPending}>Create workspace</Button>
            </div>
          </SectionCard>
        )}

        <SectionCard
          title={TAB_LABELS[tab]}
          titleIcon={<Icon name={tab === 'revenue' ? 'trophy' : tab === 'ai-usage' ? 'zap' : tab === 'features' ? 'layers' : 'globe'} size="md" className="text-[var(--teal)]" />}
          titleExtra={<Badge label="Legacy parity carried over" tone="zinc" variant="soft" />}
          noPadding
        >
          <div className="p-4">{activeContent}</div>
        </SectionCard>
      </div>
    </PageContainer>
  );
}
