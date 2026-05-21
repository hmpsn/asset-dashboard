const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
};

export function normalizeLocalSeoCountryName(country: string): string {
  const trimmed = country.trim();
  if (/^(us|usa|u\.s\.|u\.s\.a\.|united states|united states of america)$/i.test(trimmed)) {
    return 'United States';
  }
  return trimmed;
}

function normalizeUsStateName(stateOrRegion: string): string {
  const trimmed = stateOrRegion.trim();
  const upper = trimmed.toUpperCase();
  return US_STATE_NAMES[upper] ?? trimmed;
}

export function buildDataForSeoLocationName(input: {
  city?: string | null;
  stateOrRegion?: string | null;
  country?: string | null;
}): string | undefined {
  const city = input.city?.trim();
  const country = input.country ? normalizeLocalSeoCountryName(input.country) : '';
  if (!city || !country) return undefined;

  if (country === 'United States') {
    const state = input.stateOrRegion ? normalizeUsStateName(input.stateOrRegion) : '';
    if (!state) return undefined;
    return `${city},${state},United States`;
  }

  return `${city},${country}`;
}
