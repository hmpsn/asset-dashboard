import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, MapPin } from 'lucide-react';
import { useDeepLinkFocus } from '../../hooks/useDeepLinkFocus';
import { SectionCard, Icon } from '../ui';
import { BusinessProfileTab } from './BusinessProfileTab';
import { LocationsTab } from './LocationsTab';

type LegacyBusinessFootprintSection = 'business-profile' | 'locations';

interface BusinessProfile {
  email?: string;
  phone?: string;
  address?: { street?: string; city?: string; state?: string; zip?: string; country?: string };
  socialProfiles?: string[];
  openingHours?: string;
  foundedDate?: string;
  numberOfEmployees?: string;
}

interface BusinessFootprintTabProps {
  workspaceId: string;
  workspaceName: string;
  liveDomain?: string;
  brandLogoUrl?: string;
  siteHasSearch?: boolean;
  businessContext?: string;
  businessProfile?: BusinessProfile | null;
  legacySection?: LegacyBusinessFootprintSection | null;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onBusinessProfileSave: () => void;
}

export function BusinessFootprintTab({
  workspaceId,
  workspaceName,
  liveDomain,
  brandLogoUrl,
  siteHasSearch,
  businessContext,
  businessProfile,
  legacySection = null,
  toast,
  onBusinessProfileSave,
}: BusinessFootprintTabProps) {
  useDeepLinkFocus();
  const [searchParams] = useSearchParams();
  const businessProfileRef = useRef<HTMLDivElement | null>(null);
  const locationsRef = useRef<HTMLDivElement | null>(null);
  const focus = searchParams.get('focus');

  useEffect(() => {
    if (!legacySection || focus) return;
    const target = legacySection === 'locations' ? locationsRef.current : businessProfileRef.current;
    if (!target) return;

    const timer = window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.focus({ preventScroll: true });
    }, 50);

    return () => window.clearTimeout(timer);
  }, [focus, legacySection]);

  return (
    <div className="space-y-8">
      <SectionCard
        title="Business Footprint"
        titleIcon={<Icon as={Building2} size="md" className="text-teal-400" />}
      >
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          Business Profile remains your schema and contact authority. Locations remain your local SEO match authority.
          They are co-located here for faster review, but they still save through separate platform contracts.
        </p>
      </SectionCard>

      <div
        ref={businessProfileRef}
        tabIndex={-1}
        data-business-footprint-section="business-profile"
        data-schema-deeplink="business-profile-section"
        className="outline-none"
      >
        <BusinessProfileTab
          workspaceId={workspaceId}
          businessProfile={businessProfile}
          businessContext={businessContext}
          brandLogoUrl={brandLogoUrl}
          siteHasSearch={siteHasSearch}
          toast={toast}
          onSave={onBusinessProfileSave}
        />
      </div>

      <div
        ref={locationsRef}
        tabIndex={-1}
        data-business-footprint-section="locations"
        data-schema-deeplink="locations-section"
        className="outline-none"
      >
        <SectionCard
          title="Locations"
          titleIcon={<Icon as={MapPin} size="md" className="text-teal-400" />}
        >
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            Manage the physical locations we use for local SEO business matching and market setup.
          </p>
        </SectionCard>
        <LocationsTab
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          liveDomain={liveDomain}
          businessProfile={businessProfile}
          toast={toast}
        />
      </div>
    </div>
  );
}
