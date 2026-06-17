import { useNavigate } from 'react-router-dom';
import { Target, ArrowUpRight } from 'lucide-react';
import { Button, Icon, SectionCard } from '../ui';
import { adminPath } from '../../routes';

interface ManageInHubCardProps {
  workspaceId: string;
}

/**
 * Reference-band-only compact replacement for the full SiteTargetKeywords list (Phase 4b). Site target
 * keywords are now managed in the Keyword Hub, so the Strategy page links across rather than re-listing
 * them. Deep-links to the Hub's in-strategy segment via the literal `?tab=in_strategy` (the two-halves
 * contract: KeywordHub reads `searchParams.get('tab')` and honors `in_strategy`). Legacy keeps the full
 * SiteTargetKeywords leaf.
 */
export function ManageInHubCard({ workspaceId }: ManageInHubCardProps) {
  const navigate = useNavigate();
  return (
    <SectionCard
      title="Site Target Keywords"
      titleIcon={<Icon as={Target} size="md" className="text-accent-brand" />}
    >
      <div className="flex items-center justify-between gap-4">
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          Your in-strategy target keywords are managed in the Keyword Hub — track, retire, and review them there.
        </p>
        <Button
          onClick={() => navigate(adminPath(workspaceId, 'seo-keywords') + '?tab=in_strategy')}
          variant="link"
          size="sm"
          icon={ArrowUpRight}
          iconPosition="right"
          className="flex-shrink-0"
        >
          Manage in Keyword Hub
        </Button>
      </div>
    </SectionCard>
  );
}
