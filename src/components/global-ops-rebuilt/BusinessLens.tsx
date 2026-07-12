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
  SectionCard,
} from '../ui';
import { mutationErrorMessage } from './globalOpsMutationFeedback';
import {
  useBusinessTabState,
  type BusinessTab,
} from './useGlobalOpsSurfaceState';
import { BusinessPanelFrame } from './wave-b/business/BusinessPanelFrame';
import { BusinessTabTray } from './wave-b/business/BusinessTabTray';

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
      ? <AIUsageSection compact />
      : tab === 'features'
        ? <FeatureLibrary embedded />
        : <SalesReport />;

  return (
    <div
      data-testid="business-rebuilt"
      data-active-tab={tab}
      className="mx-auto min-h-full w-full max-w-[1080px] px-4 sm:px-[30px]"
    >
      <header data-testid="business-header" className="mb-4 flex items-center gap-[13px]">
        <span className="inline-flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border border-[var(--brand-border)] bg-[var(--surface-2)] text-[var(--yellow)]">
          <Icon name="chart" size="lg" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="t-h2 !font-bold text-[var(--brand-text-bright)]">Business</h1>
          <p className="mt-0.5 t-caption-sm text-[var(--brand-text)]">Revenue, AI usage, the feature library, and prospect reports</p>
        </div>
      </header>

      {invalidTab && (
        <div className="mb-3">
          <InlineBanner
            tone="warning"
            title="Unknown Business tab"
            message={`The requested tab is not active, so Business opened ${TAB_LABELS[tab]}.`}
            data-testid="business-invalid-tab-fallback"
          />
        </div>
      )}

      <BusinessTabTray value={tab} onChange={setTab} />

      {tab === 'prospects' && prospectUrl && (
        <SectionCard
          title="Create workspace from prospect"
          titleIcon={<Icon name="plus" size="md" className="text-[var(--teal)]" />}
          titleExtra={<Badge label={domainFromUrl(prospectUrl)} tone="blue" variant="soft" />}
          className="mb-[14px]"
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <FormInput value={workspaceName} onChange={setWorkspaceName} placeholder="Workspace name" className="flex-1" />
            <Button onClick={createFromProspect} loading={createWorkspace.isPending}>Create workspace</Button>
          </div>
        </SectionCard>
      )}

      <BusinessPanelFrame tab={tab}>{activeContent}</BusinessPanelFrame>
    </div>
  );
}
