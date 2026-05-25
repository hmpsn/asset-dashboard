import { describe, expect, it } from 'vitest';
import { getTaxonomyForIndustry, DENTAL_SERVICES } from '../../server/service-taxonomy.js';

describe('getTaxonomyForIndustry', () => {
  it('returns dental taxonomy for "dental"', () => {
    const taxonomy = getTaxonomyForIndustry('dental');
    expect(taxonomy).toBe(DENTAL_SERVICES);
  });

  it('returns dental taxonomy for "dentistry"', () => {
    const taxonomy = getTaxonomyForIndustry('dentistry');
    expect(taxonomy).toBe(DENTAL_SERVICES);
  });

  it('is case-insensitive', () => {
    expect(getTaxonomyForIndustry('Dental')).toBe(DENTAL_SERVICES);
    expect(getTaxonomyForIndustry('DENTISTRY')).toBe(DENTAL_SERVICES);
    expect(getTaxonomyForIndustry('Pediatric Dentistry')).toBe(DENTAL_SERVICES);
  });

  it('trims whitespace before matching', () => {
    expect(getTaxonomyForIndustry('  dental  ')).toBe(DENTAL_SERVICES);
  });

  it('matches when the pattern is a substring of the industry string', () => {
    // "cosmetic dentistry" contains "dentist"
    expect(getTaxonomyForIndustry('cosmetic dentistry')).toBe(DENTAL_SERVICES);
  });

  it('returns null for an unknown industry', () => {
    expect(getTaxonomyForIndustry('plumbing')).toBeNull();
    expect(getTaxonomyForIndustry('accounting')).toBeNull();
    expect(getTaxonomyForIndustry('restaurant')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(getTaxonomyForIndustry(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(getTaxonomyForIndustry(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getTaxonomyForIndustry('')).toBeNull();
  });
});

describe('DENTAL_SERVICES', () => {
  it('has expected number of service definitions', () => {
    expect(DENTAL_SERVICES.length).toBeGreaterThan(0);
  });

  it('each service has required fields', () => {
    for (const service of DENTAL_SERVICES) {
      expect(typeof service.id).toBe('string');
      expect(service.id.length).toBeGreaterThan(0);
      expect(typeof service.label).toBe('string');
      expect(service.label.length).toBeGreaterThan(0);
      expect(Array.isArray(service.starterKeywords)).toBe(true);
      expect(service.starterKeywords.length).toBeGreaterThan(0);
      expect(Array.isArray(service.matchTerms)).toBe(true);
      expect(service.matchTerms.length).toBeGreaterThan(0);
    }
  });

  it('contains general-dentistry service', () => {
    const generalDentistry = DENTAL_SERVICES.find(s => s.id === 'general-dentistry');
    expect(generalDentistry).toBeDefined();
    expect(generalDentistry?.label).toBe('General Dentistry');
  });

  it('contains dental-implants service with correct matchTerms', () => {
    const implants = DENTAL_SERVICES.find(s => s.id === 'dental-implants');
    expect(implants).toBeDefined();
    expect(implants?.matchTerms).toContain('implant');
  });

  it('each service id is unique', () => {
    const ids = DENTAL_SERVICES.map(s => s.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('matchTerms are lowercase', () => {
    for (const service of DENTAL_SERVICES) {
      for (const term of service.matchTerms) {
        expect(term).toBe(term.toLowerCase());
      }
    }
  });

  it('contains emergency-dental service', () => {
    const emergency = DENTAL_SERVICES.find(s => s.id === 'emergency-dental');
    expect(emergency).toBeDefined();
    expect(emergency?.matchTerms.some(t => t.includes('emergency'))).toBe(true);
  });
});
