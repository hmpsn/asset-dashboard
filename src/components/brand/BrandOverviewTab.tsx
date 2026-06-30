import { Link } from 'react-router-dom';
import { BrainCircuit, Building2, MapPin, Sparkles } from 'lucide-react';
import { useLocalSeoLocations } from '../../hooks/admin/useLocalSeoLocations';
import { adminPath } from '../../routes';
import { Badge, Icon, SectionCard } from '../ui';

interface IntelligenceProfile {
  industry?: string;
  goals?: string[];
  targetAudience?: string;
}

interface BusinessProfile {
  email?: string;
  phone?: string;
  address?: { street?: string; city?: string; state?: string; zip?: string; country?: string };
  socialProfiles?: string[];
}

interface BrandOverviewTabProps {
  workspaceId: string;
  brandVoice?: string;
  knowledgeBase?: string;
  personasCount: number;
  businessContext?: string;
  intelligenceProfile?: IntelligenceProfile | null;
  businessProfile?: BusinessProfile | null;
}

interface SnapshotCardProps {
  title: string;
  icon: typeof Sparkles;
  summary: string;
  notes: string[];
  badge?: string;
  actionLabel: string;
  to: string;
}

function SnapshotCard({ title, icon, summary, notes, badge, actionLabel, to }: SnapshotCardProps) {
  const action = (
    <Link
      to={to}
      className="t-caption-sm font-medium text-teal-400 hover:text-teal-300 transition-colors"
    >
      {actionLabel}
    </Link>
  );

  return (
    <SectionCard
      title={title}
      titleIcon={<Icon as={icon} size="md" className="text-teal-400" />}
      titleExtra={badge ? <Badge label={badge} tone="teal" variant="soft" shape="pill" /> : undefined}
      action={action}
      className="h-full"
    >
      <div className="space-y-3">
        <p className="t-body text-[var(--brand-text)]">{summary}</p>
        <div className="space-y-1.5">
          {notes.map(note => (
            <p key={note} className="t-caption-sm text-[var(--brand-text-muted)]">
              {note}
            </p>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

export function BrandOverviewTab({
  workspaceId,
  brandVoice,
  knowledgeBase,
  personasCount,
  businessContext,
  intelligenceProfile,
  businessProfile,
}: BrandOverviewTabProps) {
  const { data: locations } = useLocalSeoLocations(workspaceId);
  const totalLocations = Array.isArray(locations) ? locations.length : 0;
  const confirmedLocations = Array.isArray(locations)
    ? locations.filter(location => location.status === 'confirmed').length
    : 0;
  const needsReviewLocations = Array.isArray(locations)
    ? locations.filter(location => location.status === 'needs_review').length
    : 0;

  const businessProfileNotes = [
    businessProfile?.phone ? 'Phone saved' : 'Phone missing',
    businessProfile?.email ? 'Email saved' : 'Email missing',
    businessProfile?.address?.city || businessProfile?.address?.state
      ? 'Address details available'
      : 'Address details missing',
  ];

  const intelligenceNotes = [
    intelligenceProfile?.industry ? `Industry: ${intelligenceProfile.industry}` : 'Industry not set',
    intelligenceProfile?.targetAudience ? 'Target audience captured' : 'Target audience not set',
    intelligenceProfile?.goals?.length
      ? `${intelligenceProfile.goals.length} goal${intelligenceProfile.goals.length === 1 ? '' : 's'} saved`
      : 'Goals not set',
  ];

  const locationSummary = needsReviewLocations > 0
    ? `${needsReviewLocations} location${needsReviewLocations === 1 ? '' : 's'} need review.`
    : confirmedLocations > 0
      ? `${confirmedLocations} confirmed location${confirmedLocations === 1 ? '' : 's'} support local SEO matching.`
      : 'No confirmed locations yet.';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <SnapshotCard
        title="Current Context"
        icon={Sparkles}
        summary={businessContext?.trim() || 'No business context saved in keyword strategy yet.'}
        badge={businessContext?.trim() ? 'Configured' : undefined}
        notes={[
          brandVoice?.trim() ? 'Brand voice saved' : 'Brand voice draft still needed',
          knowledgeBase?.trim() ? 'Knowledge base saved' : 'Knowledge base still empty',
          personasCount > 0 ? `${personasCount} persona${personasCount === 1 ? '' : 's'} available` : 'No personas saved yet',
        ]}
        actionLabel="Open context"
        to={`${adminPath(workspaceId, 'brand')}?tab=context`}
      />

      <SnapshotCard
        title="Intelligence Profile"
        icon={BrainCircuit}
        summary={intelligenceProfile?.targetAudience?.trim() || intelligenceProfile?.industry?.trim() || 'No strategic AI context saved yet.'}
        badge={intelligenceProfile?.industry || intelligenceProfile?.targetAudience || intelligenceProfile?.goals?.length ? 'Configured' : undefined}
        notes={intelligenceNotes}
        actionLabel="Edit profile"
        to={`${adminPath(workspaceId, 'brand')}?tab=intelligence-profile`}
      />

      <SnapshotCard
        title="Business Profile"
        icon={Building2}
        summary={businessProfile?.address?.city || businessProfile?.phone || businessProfile?.email
          ? 'Schema and contact authority is partially configured.'
          : 'No verified contact or schema profile fields saved yet.'}
        badge={businessProfile?.phone || businessProfile?.email || businessProfile?.address?.city ? 'Configured' : undefined}
        notes={businessProfileNotes}
        actionLabel="Open business footprint"
        to={`${adminPath(workspaceId, 'brand')}?tab=business-footprint&focus=business-profile-section`}
      />

      <SnapshotCard
        title="Locations"
        icon={MapPin}
        summary={locationSummary}
        badge={totalLocations > 0 ? `${totalLocations} saved` : undefined}
        notes={[
          confirmedLocations > 0 ? `${confirmedLocations} confirmed location${confirmedLocations === 1 ? '' : 's'}` : 'No confirmed locations',
          needsReviewLocations > 0 ? `${needsReviewLocations} need review` : 'No locations waiting on review',
          totalLocations === 0 ? 'Primary-domain fallback is still in effect' : 'Used for local SEO business matching',
        ]}
        actionLabel="Manage locations"
        to={`${adminPath(workspaceId, 'brand')}?tab=business-footprint&focus=locations-section`}
      />
    </div>
  );
}
