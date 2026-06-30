import { useNavigate } from 'react-router-dom';
import { ArrowRight, MapPin } from 'lucide-react';

import { adminPath } from '../../routes';
import { useLocalSeo } from '../../hooks/admin';
import { Badge, Button, Icon, SectionCard } from '../ui';

function setupTone(setupState?: string): 'blue' | 'emerald' | 'amber' | 'zinc' {
  if (setupState === 'has_data') return 'emerald';
  if (setupState === 'ready_no_data') return 'blue';
  if (setupState === 'needs_market') return 'amber';
  return 'zinc';
}

export function LocalPresenceHandoff({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useLocalSeo(workspaceId);
  const report = data?.report;

  const description = report
    ? `${report.activeMarketCount} active ${report.activeMarketCount === 1 ? 'market' : 'markets'} / ${report.checkedKeywordCount} checked local ${report.checkedKeywordCount === 1 ? 'keyword' : 'keywords'}`
    : isLoading
      ? 'Loading local markets and visibility posture...'
      : 'Open the local operating surface for markets, visibility, and GBP review aggregates.';

  return (
    <SectionCard
      title="Local Presence"
      titleExtra={report ? (
        <Badge
          label={report.setupState.replace(/_/g, ' ')}
          tone={setupTone(report.setupState)}
          variant="outline"
          shape="pill"
        />
      ) : undefined}
      action={
        <Button
          variant="secondary"
          size="sm"
          icon={ArrowRight}
          iconPosition="right"
          onClick={() => navigate(adminPath(workspaceId, 'local-seo'))}
        >
          Open Local Presence
        </Button>
      }
      variant="subtle"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-[var(--radius-lg)] border border-blue-500/25 bg-blue-500/10 flex items-center justify-center shrink-0">
          <Icon as={MapPin} size="md" className="text-blue-400" />
        </div>
        <div className="min-w-0">
          <p className="t-caption font-semibold text-[var(--brand-text-bright)]">Workspace-level local SEO now lives in Local Presence.</p>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">{description}</p>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
            Keyword rows, local filters, and detail evidence stay here in Keyword Hub.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
