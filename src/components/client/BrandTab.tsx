// src/components/client/BrandTab.tsx
// Client portal Brand tab — editable business profile + read-only brand positioning.
// Feature-flagged: 'client-brand-section'
// Design rules: no purple, teal for CTAs, SectionCard for all panels.

import { useState, useEffect } from 'react';
import { Building2, Phone, Mail, MapPin, Globe, ChevronRight, Sparkles } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { EmptyState } from '../ui/EmptyState';
import { Icon, Button } from '../ui';
import { ErrorBoundary } from '../ErrorBoundary';
import type { BusinessProfile } from './types';

function isValidUrl(url: string): boolean {
  try { new URL(url); return true; } catch { return false; }
}

interface BrandTabProps {
  businessProfile?: BusinessProfile;
  /** Plain-language brand voice summary (NOT the full brand voice doc). */
  brandVoiceSummary?: string;
  /** Industry from intelligenceProfile — used for contextual placeholder */
  industry?: string;
  onSaveBusinessProfile: (profile: BusinessProfile) => Promise<void>;
}

export function BrandTab({
  businessProfile,
  brandVoiceSummary,
  industry,
  onSaveBusinessProfile,
}: BrandTabProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Local form state — initialised from props
  // socialProfiles are sanitized on load: strip malformed URLs stored before validation was added
  // so that saving any other field doesn't fail Zod validation on old data
  const sanitize = (profile: BusinessProfile | undefined): BusinessProfile => {
    const p = profile ?? {};
    if (!p.socialProfiles) return p;
    return { ...p, socialProfiles: p.socialProfiles.filter(u => !u || isValidUrl(u)) };
  };
  const [form, setForm] = useState<BusinessProfile>(() => sanitize(businessProfile));

  // Re-sync form when prop changes externally (e.g. admin edits via WebSocket) but only
  // when not in edit mode — avoids clobbering in-progress edits
  useEffect(() => {
    if (!editing) {
      setForm(sanitize(businessProfile));
    }
  }, [businessProfile, editing]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveBusinessProfile(form);
      setEditing(false);
    } catch {
      setSaveError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm(businessProfile ?? {});
    setEditing(false);
  };

  const updateAddress = (field: keyof NonNullable<BusinessProfile['address']>, value: string) => {
    setForm(prev => ({
      ...prev,
      address: { ...prev.address, [field]: value },
    }));
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div>
        <h2 className="t-h2 text-[var(--brand-text)]">Business Profile</h2>
        <p className="t-body text-[var(--brand-text-muted)] mt-0.5">
          Keep your business information up to date. This helps us personalize your SEO strategy.
        </p>
      </div>

      {/* ── Business Profile Panel (editable) ── */}
      <ErrorBoundary label="Business Profile">
        <SectionCard
          title="Contact & Business Info"
          titleIcon={<Icon as={Building2} size="md" className="text-accent-brand" />}
          action={
            !editing ? (
              <button
                onClick={() => setEditing(true)}
                className="t-caption text-accent-brand hover:text-accent-brand transition-colors flex items-center gap-1"
              >
                Edit <Icon as={ChevronRight} size="sm" />
              </button>
            ) : null
          }
        >
          {!editing ? (
            // ── Read view ──
            <div className="space-y-3">
              {!businessProfile?.phone && !businessProfile?.email && !businessProfile?.address?.city && (
                <EmptyState
                  icon={Building2}
                  title="No business info added yet"
                  description="Add your contact details so we can keep your site schema accurate."
                  action={
                    <Button onClick={() => setEditing(true)} className="mt-3">
                      Add Business Info
                    </Button>
                  }
                />
              )}
              {businessProfile?.phone && (
                <div className="flex items-center gap-3 t-body">
                  <Icon as={Phone} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                  <span className="text-[var(--brand-text)]">{businessProfile.phone}</span>
                </div>
              )}
              {businessProfile?.email && (
                <div className="flex items-center gap-3 t-body">
                  <Icon as={Mail} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                  <span className="text-[var(--brand-text)]">{businessProfile.email}</span>
                </div>
              )}
              {businessProfile?.address && (businessProfile.address.city || businessProfile.address.street) && (
                <div className="flex items-start gap-3 t-body">
                  <Icon as={MapPin} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0 mt-0.5" />
                  <div className="text-[var(--brand-text)]">
                    {businessProfile.address.street && <div>{businessProfile.address.street}</div>}
                    {(businessProfile.address.city || businessProfile.address.state) && (
                      <div>
                        {[businessProfile.address.city, businessProfile.address.state, businessProfile.address.zip]
                          .filter(Boolean).join(', ')}
                      </div>
                    )}
                    {businessProfile.address.country && <div>{businessProfile.address.country}</div>}
                  </div>
                </div>
              )}
              {businessProfile?.openingHours && (
                <div className="flex items-center gap-3 t-body">
                  <Icon as={Globe} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                  <span className="text-[var(--brand-text)]">{businessProfile.openingHours}</span>
                </div>
              )}
              {businessProfile?.socialProfiles && businessProfile.socialProfiles.filter(u => u.trim()).length > 0 && (
                <div className="flex items-start gap-3 t-body">
                  <Icon as={Globe} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    {businessProfile.socialProfiles.filter(u => u.trim()).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="block text-accent-brand hover:text-accent-brand truncate t-caption transition-colors">
                        {url}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // ── Edit form ──
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block t-caption-sm text-[var(--brand-text-muted)] mb-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone ?? ''}
                    onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder={industry ? `e.g. +1 (555) 000-0000` : '+1 (555) 000-0000'}
                    className="w-full px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)] border border-[var(--brand-border-strong)] text-[var(--brand-text)] t-body focus:outline-none focus:border-teal-500 transition-colors placeholder:text-[var(--brand-text-faint)]"
                  />
                </div>
                <div>
                  <label className="block t-caption-sm text-[var(--brand-text-muted)] mb-1">Business Email</label>
                  <input
                    type="email"
                    value={form.email ?? ''}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="hello@yourbusiness.com"
                    className="w-full px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)] border border-[var(--brand-border-strong)] text-[var(--brand-text)] t-body focus:outline-none focus:border-teal-500 transition-colors placeholder:text-[var(--brand-text-faint)]"
                  />
                </div>
              </div>

              <div>
                <label className="block t-caption-sm text-[var(--brand-text-muted)] mb-1">Street Address</label>
                <input
                  type="text"
                  value={form.address?.street ?? ''}
                  onChange={e => updateAddress('street', e.target.value)}
                  placeholder="123 Main St"
                  className="w-full px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)] border border-[var(--brand-border-strong)] text-[var(--brand-text)] t-body focus:outline-none focus:border-teal-500 transition-colors placeholder:text-[var(--brand-text-faint)]"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className="block t-caption-sm text-[var(--brand-text-muted)] mb-1">City</label>
                  <input
                    type="text"
                    value={form.address?.city ?? ''}
                    onChange={e => updateAddress('city', e.target.value)}
                    placeholder="City"
                    className="w-full px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)] border border-[var(--brand-border-strong)] text-[var(--brand-text)] t-body focus:outline-none focus:border-teal-500 transition-colors placeholder:text-[var(--brand-text-faint)]"
                  />
                </div>
                <div>
                  <label className="block t-caption-sm text-[var(--brand-text-muted)] mb-1">State</label>
                  <input
                    type="text"
                    value={form.address?.state ?? ''}
                    onChange={e => updateAddress('state', e.target.value)}
                    placeholder="CA"
                    className="w-full px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)] border border-[var(--brand-border-strong)] text-[var(--brand-text)] t-body focus:outline-none focus:border-teal-500 transition-colors placeholder:text-[var(--brand-text-faint)]"
                  />
                </div>
                <div>
                  <label className="block t-caption-sm text-[var(--brand-text-muted)] mb-1">ZIP</label>
                  <input
                    type="text"
                    value={form.address?.zip ?? ''}
                    onChange={e => updateAddress('zip', e.target.value)}
                    placeholder="90210"
                    className="w-full px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)] border border-[var(--brand-border-strong)] text-[var(--brand-text)] t-body focus:outline-none focus:border-teal-500 transition-colors placeholder:text-[var(--brand-text-faint)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block t-caption-sm text-[var(--brand-text-muted)] mb-1">Country</label>
                  <input
                    type="text"
                    value={form.address?.country ?? ''}
                    onChange={e => updateAddress('country', e.target.value)}
                    placeholder="United States"
                    className="w-full px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)] border border-[var(--brand-border-strong)] text-[var(--brand-text)] t-body focus:outline-none focus:border-teal-500 transition-colors placeholder:text-[var(--brand-text-faint)]"
                  />
                </div>
                <div>
                  <label className="block t-caption-sm text-[var(--brand-text-muted)] mb-1">Hours</label>
                  <input
                    type="text"
                    value={form.openingHours ?? ''}
                    onChange={e => setForm(p => ({ ...p, openingHours: e.target.value }))}
                    placeholder="Mon-Fri 9am–5pm"
                    className="w-full px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)] border border-[var(--brand-border-strong)] text-[var(--brand-text)] t-body focus:outline-none focus:border-teal-500 transition-colors placeholder:text-[var(--brand-text-faint)]"
                  />
                </div>
              </div>

              {saveError && (
                <p className="t-caption text-accent-danger">{saveError}</p>
              )}
              <div className="flex items-center gap-3 pt-1">
                <Button onClick={handleSave} disabled={saving} loading={saving}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </Button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-[var(--radius-lg)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] t-caption transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </SectionCard>
      </ErrorBoundary>

      {/* ── Brand Positioning Panel (read-only) ── */}
      <ErrorBoundary label="Brand Positioning">
        <SectionCard
          title="Brand Positioning"
          titleIcon={<Icon as={Sparkles} size="md" className="text-accent-brand" />}
          titleExtra={<span className="t-caption-sm px-2 py-0.5 rounded-[var(--radius-pill)] bg-teal-500/10 text-accent-brand border border-teal-500/20">AI-generated</span>}
        >
          {brandVoiceSummary ? (
            <div className="space-y-3">
              <p className="t-body text-[var(--brand-text)] leading-relaxed">{brandVoiceSummary}</p>
              <p className="t-caption-sm text-[var(--brand-text-faint)]">
                This summary reflects how your brand communicates. Contact your agency to update your brand voice guidelines.
              </p>
            </div>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="Brand positioning not yet generated"
              description="Your agency will set up your brand voice guidelines. Check back after your onboarding is complete."
            />
          )}
        </SectionCard>
      </ErrorBoundary>
    </div>
  );
}
