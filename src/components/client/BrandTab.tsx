// src/components/client/BrandTab.tsx
// Client portal Brand tab — editable business profile + read-only brand positioning.
// Feature-flagged: 'client-brand-section'
// Design rules: no purple, teal for CTAs, SectionCard for all panels.

import { useState } from 'react';
import { Building2, Phone, Mail, MapPin, Globe, ChevronRight, Sparkles } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBoundary } from '../ErrorBoundary';

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

interface BrandTabProps {
  workspaceId: string;
  workspaceName: string;
  businessProfile?: BusinessProfile;
  /** Plain-language brand voice summary (NOT the full brand voice doc). */
  brandVoiceSummary?: string;
  /** Industry from intelligenceProfile — used for contextual placeholder */
  industry?: string;
  onSaveBusinessProfile: (profile: BusinessProfile) => Promise<void>;
}

export function BrandTab({
  workspaceId,
  workspaceName,
  businessProfile,
  brandVoiceSummary,
  industry,
  onSaveBusinessProfile,
}: BrandTabProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Local form state — initialised from props
  const [form, setForm] = useState<BusinessProfile>(() => businessProfile ?? {});

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveBusinessProfile(form);
      setEditing(false);
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
        <h2 className="text-lg font-semibold text-zinc-100">Business Profile</h2>
        <p className="text-sm text-zinc-500 mt-0.5">
          Keep your business information up to date. This helps us personalize your SEO strategy.
        </p>
      </div>

      {/* ── Business Profile Panel (editable) ── */}
      <ErrorBoundary label="Business Profile">
        <SectionCard
          title="Contact & Business Info"
          titleIcon={<Building2 className="w-4 h-4 text-teal-400" />}
          action={
            !editing ? (
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-teal-400 hover:text-teal-300 transition-colors flex items-center gap-1"
              >
                Edit <ChevronRight className="w-3 h-3" />
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
                    <button
                      onClick={() => setEditing(true)}
                      className="mt-3 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-medium transition-all"
                    >
                      Add Business Info
                    </button>
                  }
                />
              )}
              {businessProfile?.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <span className="text-zinc-300">{businessProfile.phone}</span>
                </div>
              )}
              {businessProfile?.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <span className="text-zinc-300">{businessProfile.email}</span>
                </div>
              )}
              {businessProfile?.address && (businessProfile.address.city || businessProfile.address.street) && (
                <div className="flex items-start gap-3 text-sm">
                  <MapPin className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                  <div className="text-zinc-300">
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
                <div className="flex items-center gap-3 text-sm">
                  <Globe className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <span className="text-zinc-300">{businessProfile.openingHours}</span>
                </div>
              )}
              {businessProfile?.socialProfiles && businessProfile.socialProfiles.length > 0 && (
                <div className="flex items-start gap-3 text-sm">
                  <Globe className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    {businessProfile.socialProfiles.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="block text-teal-400 hover:text-teal-300 truncate text-xs transition-colors">
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
                  <label className="block text-[11px] text-zinc-500 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone ?? ''}
                    onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder={industry ? `e.g. +1 (555) 000-0000` : '+1 (555) 000-0000'}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Business Email</label>
                  <input
                    type="email"
                    value={form.email ?? ''}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="hello@yourbusiness.com"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Street Address</label>
                <input
                  type="text"
                  value={form.address?.street ?? ''}
                  onChange={e => updateAddress('street', e.target.value)}
                  placeholder="123 Main St"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] text-zinc-500 mb-1">City</label>
                  <input
                    type="text"
                    value={form.address?.city ?? ''}
                    onChange={e => updateAddress('city', e.target.value)}
                    placeholder="City"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">State</label>
                  <input
                    type="text"
                    value={form.address?.state ?? ''}
                    onChange={e => updateAddress('state', e.target.value)}
                    placeholder="CA"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">ZIP</label>
                  <input
                    type="text"
                    value={form.address?.zip ?? ''}
                    onChange={e => updateAddress('zip', e.target.value)}
                    placeholder="90210"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Country</label>
                  <input
                    type="text"
                    value={form.address?.country ?? ''}
                    onChange={e => updateAddress('country', e.target.value)}
                    placeholder="United States"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Hours</label>
                  <input
                    type="text"
                    value={form.openingHours ?? ''}
                    onChange={e => setForm(p => ({ ...p, openingHours: e.target.value }))}
                    placeholder="Mon-Fri 9am–5pm"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-teal-500 transition-colors placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-xs font-medium transition-all"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-lg text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
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
          titleIcon={<Sparkles className="w-4 h-4 text-teal-400" />}
          titleExtra={<span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">AI-generated</span>}
        >
          {brandVoiceSummary ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-300 leading-relaxed">{brandVoiceSummary}</p>
              <p className="text-[11px] text-zinc-600">
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
