import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Phone, Mail, MapPin, Link2, Clock, Save } from 'lucide-react';
import { put } from '../../api/client';
import { SectionCard, Icon, Button } from '../ui';
import { useDeepLinkFocus } from '../../hooks/useDeepLinkFocus';
import { adminPath } from '../../routes';

interface BusinessProfile {
  phone?: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  socialProfiles?: string[];
  openingHours?: string;
  foundedDate?: string;
  numberOfEmployees?: string;
}

interface BusinessProfileTabProps {
  workspaceId: string;
  businessProfile?: BusinessProfile | null;
  businessContext?: string;
  brandLogoUrl?: string;
  siteHasSearch?: boolean;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onSave: (profile: BusinessProfile) => void;
}

function SchemaImpactRow({
  field,
  filled,
  hint,
  target,
  scrollTo,
  workspaceId,
}: {
  field: string;
  filled: boolean;
  hint: string | null;
  target?: { tab: string; focus: string };
  scrollTo?: string;
  workspaceId: string;
}) {
  const linkTarget = target ? `${adminPath(workspaceId, 'settings')}?tab=${target.tab}&focus=${target.focus}` : null;
  const handleScroll = scrollTo
    ? () => {
        const el = document.querySelector<HTMLElement>(`[data-schema-deeplink="${scrollTo}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const focusable = el?.querySelector<HTMLInputElement>('input, textarea, select') ?? (el instanceof HTMLInputElement ? el : null);
        focusable?.focus({ preventScroll: true });
      }
    : null;

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {filled ? (
          <span className="text-emerald-400 text-sm shrink-0">✓</span>
        ) : (
          <span className="text-amber-400 text-sm shrink-0">✗</span>
        )}
        <span className="t-body text-[var(--brand-text)] truncate">{field}</span>
        {hint && <span className="t-caption-sm text-[var(--brand-text-muted)] truncate">{hint}</span>}
      </div>
      {linkTarget && (
        <Link
          to={linkTarget}
          className="t-caption text-[var(--brand-text-bright)] hover:underline shrink-0"
        >
          Edit →
        </Link>
      )}
      {handleScroll && (
        <button
          type="button"
          onClick={handleScroll}
          className="t-caption text-[var(--brand-text-bright)] hover:underline shrink-0"
        >
          Jump to →
        </button>
      )}
    </div>
  );
}

export function BusinessProfileTab({ workspaceId, businessProfile, businessContext, brandLogoUrl, siteHasSearch, toast, onSave }: BusinessProfileTabProps) {
  useDeepLinkFocus();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<BusinessProfile>({
    phone: businessProfile?.phone || '',
    email: businessProfile?.email || '',
    address: {
      street: businessProfile?.address?.street || '',
      city: businessProfile?.address?.city || '',
      state: businessProfile?.address?.state || '',
      zip: businessProfile?.address?.zip || '',
      country: businessProfile?.address?.country || '',
    },
    socialProfiles: businessProfile?.socialProfiles || [],
    openingHours: businessProfile?.openingHours || '',
    foundedDate: businessProfile?.foundedDate || '',
    numberOfEmployees: businessProfile?.numberOfEmployees || '',
  });
  const [socialInput, setSocialInput] = useState('');

  const isMissingCriticalFields = !businessProfile?.phone &&
    !businessProfile?.address?.street &&
    !businessProfile?.email;

  const isLocalBusinessContext = /\b(dental|dentist|clinic|medical|attorney|accountant|restaurant|retail|salon|spa|plumber|electrician|contractor)\b/i
    .test(businessContext || '');

  // Re-initialize form if businessProfile prop arrives after mount (ws loads async)
  useEffect(() => {
    if (!businessProfile) return;
    setForm({
      phone: businessProfile.phone || '',
      email: businessProfile.email || '',
      address: {
        street: businessProfile.address?.street || '',
        city: businessProfile.address?.city || '',
        state: businessProfile.address?.state || '',
        zip: businessProfile.address?.zip || '',
        country: businessProfile.address?.country || '',
      },
      socialProfiles: businessProfile.socialProfiles || [],
      openingHours: businessProfile.openingHours || '',
      foundedDate: businessProfile.foundedDate || '',
      numberOfEmployees: businessProfile.numberOfEmployees || '',
    });
  }, [businessProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: keyof BusinessProfile, value: string) =>
    setForm(f => ({ ...f, [key]: value }));

  const updateAddress = (key: keyof NonNullable<BusinessProfile['address']>, value: string) =>
    setForm(f => ({ ...f, address: { ...f.address, [key]: value } }));

  const addSocial = () => {
    const url = socialInput.trim();
    if (!url) return;
    try { new URL(url); } catch { toast('Enter a valid URL', 'error'); return; }
    if ((form.socialProfiles || []).includes(url)) { toast('Already added', 'error'); return; }
    setForm(f => ({ ...f, socialProfiles: [...(f.socialProfiles || []), url] }));
    setSocialInput('');
  };

  const removeSocial = (url: string) =>
    setForm(f => ({ ...f, socialProfiles: (f.socialProfiles || []).filter(u => u !== url) }));

  const handleSave = async () => {
    setSaving(true);
    try {
      // Strip empty strings so we don't persist blank values
      const payload: BusinessProfile = {};
      if (form.phone?.trim()) payload.phone = form.phone.trim();
      if (form.email?.trim()) payload.email = form.email.trim();
      const addr = form.address || {};
      const hasAddress = Object.values(addr).some(v => v?.trim());
      if (hasAddress) {
        payload.address = {};
        if (addr.street?.trim()) payload.address.street = addr.street.trim();
        if (addr.city?.trim()) payload.address.city = addr.city.trim();
        if (addr.state?.trim()) payload.address.state = addr.state.trim();
        if (addr.zip?.trim()) payload.address.zip = addr.zip.trim();
        if (addr.country?.trim()) payload.address.country = addr.country.trim();
      }
      if (form.socialProfiles?.length) payload.socialProfiles = form.socialProfiles;
      if (form.openingHours?.trim()) payload.openingHours = form.openingHours.trim();
      if (form.foundedDate?.trim()) payload.foundedDate = form.foundedDate.trim();
      if (form.numberOfEmployees?.trim()) payload.numberOfEmployees = form.numberOfEmployees.trim();

      await put(`/api/workspaces/${workspaceId}/business-profile`, payload);
      onSave(payload);
      toast('Business profile saved');
    } catch {
      toast('Failed to save business profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = 'w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 transition-colors';
  const labelClass = 'block t-caption-sm font-medium text-[var(--brand-text)] mb-1';

  return (
    <div className="space-y-8">
      <SectionCard title="Schema impact" className="mb-6">
        <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">
          These fields shape how Google understands your business in search.
        </p>
        <div className="space-y-2">
          <SchemaImpactRow
            field="Brand logo"
            filled={!!brandLogoUrl}
            target={{ tab: 'features', focus: 'brandLogoUrl' }}
            hint={brandLogoUrl ? null : 'Upload in Settings · Features'}
            workspaceId={workspaceId}
          />
          <SchemaImpactRow
            field="Address"
            filled={!!(businessProfile?.address?.city || businessProfile?.address?.state)}
            scrollTo="address"
            hint={businessProfile?.address?.city ? null : 'Enables Service.areaServed for local SEO'}
            workspaceId={workspaceId}
          />
          <SchemaImpactRow
            field="Phone"
            filled={!!businessProfile?.phone}
            scrollTo="phone"
            hint={businessProfile?.phone ? null : 'Required for LocalBusiness rich snippet'}
            workspaceId={workspaceId}
          />
          <SchemaImpactRow
            field="Social profiles"
            filled={!!(businessProfile?.socialProfiles?.length)}
            scrollTo="socialProfiles"
            hint={businessProfile?.socialProfiles?.length ? null : 'Populates Organization.sameAs'}
            workspaceId={workspaceId}
          />
          <SchemaImpactRow
            field="Site search endpoint"
            filled={!!siteHasSearch}
            target={{ tab: 'features', focus: 'siteHasSearch' }}
            hint={siteHasSearch ? null : 'Toggle on in Settings · Features when search is wired'}
            workspaceId={workspaceId}
          />
        </div>
      </SectionCard>

      {isMissingCriticalFields && isLocalBusinessContext && (
        <div className="rounded-[var(--radius-lg)] border border-amber-500/30 bg-amber-500/10 p-4 mb-6">
          <p className="t-body text-amber-400 font-medium mb-1">Business profile incomplete</p>
          <p className="t-caption text-[var(--brand-text-muted)]">
            Schema generation for local businesses uses your verified business profile to populate
            phone, address, and hours — bypassing the need for this data to appear on each page.
            Add at least one contact field to improve schema accuracy.
          </p>
        </div>
      )}

      {/* Header */}
      <SectionCard noPadding>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center">
            <Icon as={Building2} size="md" className="text-teal-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Business Profile</h3>
            <p className="t-caption text-[var(--brand-text-muted)]">
              Verified contact details — used directly in schema without requiring them to appear on each page
            </p>
          </div>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Contact */}
          <div>
            <h4 className="t-caption-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-3">Contact</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>
                  <span className="inline-flex items-center gap-1"><Icon as={Phone} size="sm" /> Phone</span>
                </label>
                <input
                  type="tel"
                  className={fieldClass}
                  placeholder="+1-555-123-4567"
                  value={form.phone || ''}
                  onChange={e => update('phone', e.target.value)}
                  data-schema-deeplink="phone"
                />
              </div>
              <div>
                <label className={labelClass}>
                  <span className="inline-flex items-center gap-1"><Icon as={Mail} size="sm" /> Email</span>
                </label>
                <input
                  type="email"
                  className={fieldClass}
                  placeholder="hello@example.com"
                  value={form.email || ''}
                  onChange={e => update('email', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Address */}
          <div data-schema-deeplink="address">
            <h4 className="t-caption-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-3">
              <span className="inline-flex items-center gap-1"><Icon as={MapPin} size="sm" /> Address</span>
            </h4>
            <div className="space-y-2">
              <div>
                <label className={labelClass}>Street</label>
                <input
                  className={fieldClass}
                  placeholder="123 Main St"
                  value={form.address?.street || ''}
                  onChange={e => updateAddress('street', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className={labelClass}>City</label>
                  <input
                    className={fieldClass}
                    placeholder="New York"
                    value={form.address?.city || ''}
                    onChange={e => updateAddress('city', e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>State / Region</label>
                  <input
                    className={fieldClass}
                    placeholder="NY"
                    value={form.address?.state || ''}
                    onChange={e => updateAddress('state', e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>ZIP / Postcode</label>
                  <input
                    className={fieldClass}
                    placeholder="10001"
                    value={form.address?.zip || ''}
                    onChange={e => updateAddress('zip', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Country</label>
                <input
                  className={fieldClass}
                  placeholder="United States"
                  value={form.address?.country || ''}
                  onChange={e => updateAddress('country', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Social Profiles */}
          <div data-schema-deeplink="socialProfiles">
            <h4 className="t-caption-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-3">
              <span className="inline-flex items-center gap-1"><Icon as={Link2} size="sm" /> Social / External Profiles</span>
            </h4>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">Used for Organization sameAs links in schema (Google Business, LinkedIn, Facebook, etc.)</p>
            <div className="flex gap-2 mb-2">
              <input
                className={`${fieldClass} flex-1`}
                placeholder="https://www.linkedin.com/company/example"
                value={socialInput}
                onChange={e => setSocialInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSocial(); } }}
              />
              <button
                onClick={addSocial}
                className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors whitespace-nowrap"
              >
                Add
              </button>
            </div>
            {(form.socialProfiles || []).length > 0 && (
              <div className="space-y-1">
                {(form.socialProfiles || []).map(url => (
                  <div key={url} className="flex items-center justify-between bg-[var(--surface-3)] rounded-[var(--radius-lg)] px-3 py-1.5">
                    <span className="t-caption-sm text-[var(--brand-text)] truncate">{url}</span>
                    <button
                      onClick={() => removeSocial(url)}
                      className="ml-2 text-[var(--brand-text-muted)] hover:text-red-400 transition-colors shrink-0"
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Hours + Business Info */}
          <div>
            <h4 className="t-caption-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-3">
              <span className="inline-flex items-center gap-1"><Icon as={Clock} size="sm" /> Business Details</span>
            </h4>
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Opening Hours</label>
                <input
                  className={fieldClass}
                  placeholder="Mon–Fri 9am–5pm, Sat 10am–2pm"
                  value={form.openingHours || ''}
                  onChange={e => update('openingHours', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Founded</label>
                  <input
                    className={fieldClass}
                    placeholder="2015"
                    value={form.foundedDate || ''}
                    onChange={e => update('foundedDate', e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>Number of Employees</label>
                  <input
                    className={fieldClass}
                    placeholder="10–50"
                    value={form.numberOfEmployees || ''}
                    onChange={e => update('numberOfEmployees', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end pt-2 border-t border-[var(--brand-border)]">
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving}
              loading={saving}
              icon={saving ? undefined : Save}
            >
              {saving ? 'Saving…' : 'Save Business Profile'}
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* Context note */}
      <SectionCard variant="subtle">
        <p className="font-medium text-[var(--brand-text)] t-caption-sm">How this is used</p>
        <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">Schema generation will inject these values directly into LocalBusiness, Organization, and related schema types — even if they don't appear on the page being analyzed. Contact details verified here also bypass the content-verification step that normally strips data not found in page HTML.</p>
      </SectionCard>
    </div>
  );
}
