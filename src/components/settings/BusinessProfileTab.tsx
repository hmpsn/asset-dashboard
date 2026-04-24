import { useState, useEffect } from 'react';
import { Building2, Phone, Mail, MapPin, Link2, Clock, Save, Loader2 } from 'lucide-react';
import { put } from '../../api/client';
import { SectionCard } from '../ui';

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
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onSave: (profile: BusinessProfile) => void;
}

export function BusinessProfileTab({ workspaceId, businessProfile, toast, onSave }: BusinessProfileTabProps) {
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

  const fieldClass = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors';
  const labelClass = 'block text-[11px] font-medium text-zinc-400 mb-1';

  return (
    <div className="space-y-8">
      {/* Header */}
      <SectionCard noPadding>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
            <Building2 className="w-4 h-4 text-teal-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">Business Profile</h3>
            <p className="text-xs text-zinc-500">
              Verified contact details — used directly in schema without requiring them to appear on each page
            </p>
          </div>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Contact */}
          <div>
            <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">Contact</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>
                  <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> Phone</span>
                </label>
                <input
                  type="tel"
                  className={fieldClass}
                  placeholder="+1-555-123-4567"
                  value={form.phone || ''}
                  onChange={e => update('phone', e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>
                  <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> Email</span>
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
          <div>
            <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> Address</span>
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
          <div>
            <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              <span className="inline-flex items-center gap-1"><Link2 className="w-3 h-3" /> Social / External Profiles</span>
            </h4>
            <p className="text-[11px] text-zinc-500 mb-2">Used for Organization sameAs links in schema (Google Business, LinkedIn, Facebook, etc.)</p>
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
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors whitespace-nowrap"
              >
                Add
              </button>
            </div>
            {(form.socialProfiles || []).length > 0 && (
              <div className="space-y-1">
                {(form.socialProfiles || []).map(url => (
                  <div key={url} className="flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-1.5">
                    <span className="text-[11px] text-zinc-300 truncate">{url}</span>
                    <button
                      onClick={() => removeSocial(url)}
                      className="ml-2 text-zinc-500 hover:text-red-400 transition-colors shrink-0"
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
            <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Business Details</span>
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
          <div className="flex justify-end pt-2 border-t border-zinc-800">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Saving…' : 'Save Business Profile'}
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Context note */}
      <SectionCard variant="subtle">
        <p className="font-medium text-zinc-400 text-[11px]">How this is used</p>
        <p className="text-[11px] text-zinc-500 mt-1">Schema generation will inject these values directly into LocalBusiness, Organization, and related schema types — even if they don't appear on the page being analyzed. Contact details verified here also bypass the content-verification step that normally strips data not found in page HTML.</p>
      </SectionCard>
    </div>
  );
}
