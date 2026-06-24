import { useState, useEffect, useMemo } from 'react';
import { Globe, Save, RotateCcw } from 'lucide-react';
import { patch } from '../../api/client';
import { SectionCard, Icon, Button, FormField, FormSelect } from '../ui';
import type { TargetGeo } from '../../../shared/types/workspace';

/**
 * Curated DataForSEO country SERP targets for the national/international geo picker.
 * `locationCode` is the DataForSEO country `location_code` (= 2000 + ISO 3166-1
 * numeric; verified against the provider's LOCATION_CODES map). `languages` are the
 * ISO 639-1 codes DataForSEO supports for that market, primary first.
 */
interface CountryTarget {
  countryCode: string; // ISO 3166-1 alpha-2
  label: string;
  locationCode: number;
  languages: { code: string; label: string }[];
}

const EN = { code: 'en', label: 'English' };
const COUNTRY_TARGETS: CountryTarget[] = [
  { countryCode: 'US', label: 'United States', locationCode: 2840, languages: [EN, { code: 'es', label: 'Spanish' }] },
  { countryCode: 'GB', label: 'United Kingdom', locationCode: 2826, languages: [EN] },
  { countryCode: 'CA', label: 'Canada', locationCode: 2124, languages: [EN, { code: 'fr', label: 'French' }] },
  { countryCode: 'AU', label: 'Australia', locationCode: 2036, languages: [EN] },
  { countryCode: 'IE', label: 'Ireland', locationCode: 2372, languages: [EN] },
  { countryCode: 'NZ', label: 'New Zealand', locationCode: 2554, languages: [EN] },
  { countryCode: 'IN', label: 'India', locationCode: 2356, languages: [EN, { code: 'hi', label: 'Hindi' }] },
  { countryCode: 'SG', label: 'Singapore', locationCode: 2702, languages: [EN] },
  { countryCode: 'ZA', label: 'South Africa', locationCode: 2710, languages: [EN] },
  { countryCode: 'DE', label: 'Germany', locationCode: 2276, languages: [{ code: 'de', label: 'German' }, EN] },
  { countryCode: 'FR', label: 'France', locationCode: 2250, languages: [{ code: 'fr', label: 'French' }] },
  { countryCode: 'ES', label: 'Spain', locationCode: 2724, languages: [{ code: 'es', label: 'Spanish' }] },
  { countryCode: 'IT', label: 'Italy', locationCode: 2380, languages: [{ code: 'it', label: 'Italian' }] },
  { countryCode: 'NL', label: 'Netherlands', locationCode: 2528, languages: [{ code: 'nl', label: 'Dutch' }, EN] },
  { countryCode: 'BE', label: 'Belgium', locationCode: 2056, languages: [{ code: 'nl', label: 'Dutch' }, { code: 'fr', label: 'French' }] },
  { countryCode: 'SE', label: 'Sweden', locationCode: 2752, languages: [{ code: 'sv', label: 'Swedish' }, EN] },
  { countryCode: 'PL', label: 'Poland', locationCode: 2616, languages: [{ code: 'pl', label: 'Polish' }] },
  { countryCode: 'BR', label: 'Brazil', locationCode: 2076, languages: [{ code: 'pt', label: 'Portuguese' }] },
  { countryCode: 'MX', label: 'Mexico', locationCode: 2484, languages: [{ code: 'es', label: 'Spanish' }] },
  { countryCode: 'JP', label: 'Japan', locationCode: 2392, languages: [{ code: 'ja', label: 'Japanese' }] },
];

const NONE = '';

function findCountryByLocationCode(locationCode?: number): CountryTarget | undefined {
  if (locationCode == null) return undefined;
  return COUNTRY_TARGETS.find(c => c.locationCode === locationCode);
}

interface TargetGeoEditorProps {
  workspaceId: string;
  targetGeo?: TargetGeo | null;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onSave: () => void;
}

/**
 * Admin editor for a workspace's national/international SERP target geo (SEO Decision
 * Engine P4). This is distinct from the local "Primary market" set under Locations:
 * the primary market drives map-pack / local-pack visibility, while this geo drives
 * which national SERP the domain/competitor/keyword provider queries run against.
 * Persists `targetGeo` via PATCH /api/workspaces/:id; clearing it falls back to the
 * local primary market, then US/English.
 */
export function TargetGeoEditor({ workspaceId, targetGeo, toast, onSave }: TargetGeoEditorProps) {
  const initialCountry = findCountryByLocationCode(targetGeo?.locationCode);
  const [countryCode, setCountryCode] = useState<string>(initialCountry?.countryCode ?? NONE);
  const [languageCode, setLanguageCode] = useState<string>(targetGeo?.languageCode ?? NONE);
  const [saving, setSaving] = useState(false);

  // Re-sync when the workspace (and its persisted geo) loads/changes after mount.
  useEffect(() => {
    const country = findCountryByLocationCode(targetGeo?.locationCode);
    setCountryCode(country?.countryCode ?? NONE);
    setLanguageCode(targetGeo?.languageCode ?? NONE);
  }, [targetGeo?.locationCode, targetGeo?.languageCode]);

  const selectedCountry = useMemo(
    () => COUNTRY_TARGETS.find(c => c.countryCode === countryCode),
    [countryCode],
  );

  const countryOptions = useMemo(
    () => COUNTRY_TARGETS.map(c => ({ value: c.countryCode, label: c.label })),
    [],
  );
  const languageOptions = useMemo(
    () => (selectedCountry?.languages ?? []).map(l => ({ value: l.code, label: l.label })),
    [selectedCountry],
  );

  const handleCountryChange = (next: string) => {
    setCountryCode(next);
    const country = COUNTRY_TARGETS.find(c => c.countryCode === next);
    // Keep the current language if the new country supports it, else default to its primary.
    const stillValid = country?.languages.some(l => l.code === languageCode);
    setLanguageCode(stillValid ? languageCode : country?.languages[0]?.code ?? NONE);
  };

  // An out-of-list persisted code (set directly via API) — surface it so the admin
  // knows a custom target is active even though the dropdown can't represent it.
  const customActive = targetGeo?.locationCode != null && !initialCountry;

  const isDirty =
    (selectedCountry?.locationCode ?? null) !== (targetGeo?.locationCode ?? null) ||
    (languageCode || null) !== (targetGeo?.languageCode ?? null);

  const handleSave = async () => {
    if (!selectedCountry || !languageCode) {
      toast('Pick a country and language first', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload: TargetGeo = {
        locationCode: selectedCountry.locationCode,
        languageCode,
        countryCode: selectedCountry.countryCode,
        label: `${selectedCountry.label} · ${languageOptions.find(l => l.value === languageCode)?.label ?? languageCode}`,
      };
      await patch(`/api/workspaces/${workspaceId}`, { targetGeo: payload });
      toast('Search target geo saved');
      onSave();
    } catch {
      toast('Failed to save target geo', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await patch(`/api/workspaces/${workspaceId}`, { targetGeo: null });
      setCountryCode(NONE);
      setLanguageCode(NONE);
      toast('Cleared — defaulting to primary market');
      onSave();
    } catch {
      toast('Failed to clear target geo', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Search Target Geo"
      titleIcon={<Icon as={Globe} size="md" className="text-teal-400" />}
    >
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-4">
        Sets the national / international SERP this client's keyword, competitor, and domain
        research runs against. This is separate from the local <span className="text-[var(--brand-text)]">Primary market</span> under
        Locations — that drives map-pack visibility, while this drives which country's organic
        search results we pull. Leave unset to default to the primary market, then US / English.
      </p>

      {targetGeo?.locationCode != null && (
        <div className="rounded-[var(--radius-lg)] border border-teal-500/30 bg-teal-500/10 px-3 py-2 mb-4">
          <p className="t-caption-sm text-[var(--brand-text)]">
            Currently targeting:{' '}
            <span className="font-medium text-teal-300">
              {targetGeo.label ?? initialCountry?.label ?? `Location ${targetGeo.locationCode}`}
              {!targetGeo.label && targetGeo.languageCode ? ` · ${targetGeo.languageCode}` : ''}
            </span>
            {customActive && <span className="text-[var(--brand-text-muted)]"> (custom code)</span>}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Country">
          <FormSelect
            options={countryOptions}
            value={countryCode}
            onChange={handleCountryChange}
            placeholder="Select a country…"
          />
        </FormField>
        <FormField label="Language">
          <FormSelect
            options={languageOptions}
            value={languageCode}
            onChange={setLanguageCode}
            placeholder={selectedCountry ? 'Select a language…' : 'Pick a country first'}
            disabled={!selectedCountry}
          />
        </FormField>
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-[var(--brand-border)]">
        {targetGeo?.locationCode != null && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClear}
            disabled={saving}
            icon={RotateCcw}
          >
            Clear
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={saving || !isDirty || !selectedCountry || !languageCode}
          loading={saving}
          icon={saving ? undefined : Save}
        >
          {saving ? 'Saving…' : 'Save Target Geo'}
        </Button>
      </div>
    </SectionCard>
  );
}
