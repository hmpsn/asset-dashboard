import type { BacklinkProfile } from '../shared/types/intelligence.js';

export type KdClassification = 'very-challenging' | 'challenging' | 'within-reach' | 'aligned';

export type AuthorityPosture =
  | 'authority_unknown'
  | 'within_current_authority_range'
  | 'requires_authority_building';

export interface AuthorityAssessment {
  posture: AuthorityPosture;
  note: string;
  referringDomains?: number;
}

export function classifyKdGap(difficulty: number, domainStrength: number): KdClassification {
  if (!domainStrength) return 'aligned';
  const kdGap = difficulty - domainStrength;
  if (kdGap >= 30) return 'very-challenging';
  if (kdGap >= 15) return 'challenging';
  if (kdGap <= -20) return 'within-reach';
  return 'aligned';
}

const KD_SCORE_MULTIPLIER: Record<KdClassification, number> = {
  'very-challenging': 0.6,
  'challenging': 0.8,
  'aligned': 1.0,
  'within-reach': 1.2,
};

export function adjustKdImpactScore(baseScore: number, difficulty: number, domainStrength: number): number {
  const classification = classifyKdGap(difficulty, domainStrength);
  const adjusted = Math.round(baseScore * KD_SCORE_MULTIPLIER[classification]);
  return classification === 'within-reach' ? Math.min(100, adjusted) : adjusted;
}

export function kdClassificationNote(difficulty: number, domainStrength: number): string {
  switch (classifyKdGap(difficulty, domainStrength)) {
    case 'very-challenging':
    case 'challenging':
      return ` (KD ${difficulty} may be challenging — consider building authority first)`;
    case 'within-reach':
      return ` (KD ${difficulty} is well within reach for your domain)`;
    case 'aligned':
      return '';
  }
}

export function backlinkProfileToAuthorityStrength(backlinkProfile?: BacklinkProfile): number {
  if (!backlinkProfile?.referringDomains) return 0;
  if (backlinkProfile.referringDomains >= 120) return 80;
  if (backlinkProfile.referringDomains >= 30) return 50;
  return 20;
}

export function assessAuthorityFromBacklinks(
  difficulty: number | null | undefined,
  backlinkProfile?: BacklinkProfile,
): AuthorityAssessment {
  if (difficulty == null) {
    return {
      posture: 'authority_unknown',
      note: 'Authority unknown — keyword difficulty data is unavailable, so treat this opportunity cautiously.',
      referringDomains: backlinkProfile?.referringDomains,
    };
  }

  if (!backlinkProfile) {
    return {
      posture: 'authority_unknown',
      note: 'Authority unknown — backlink data is unavailable, so treat keyword difficulty cautiously.',
    };
  }

  if (backlinkProfile.referringDomains <= 0) {
    return {
      posture: 'requires_authority_building',
      note: 'Requires authority building — the current backlink footprint is minimal, so prioritize easier terms first.',
      referringDomains: backlinkProfile.referringDomains,
    };
  }

  const domainStrength = backlinkProfileToAuthorityStrength(backlinkProfile);
  const classification = classifyKdGap(difficulty, domainStrength);
  if (classification === 'very-challenging' || classification === 'challenging') {
    return {
      posture: 'requires_authority_building',
      note: `Requires authority building — KD ${difficulty} looks ambitious for the current backlink footprint (${backlinkProfile.referringDomains.toLocaleString()} referring domains).`,
      referringDomains: backlinkProfile.referringDomains,
    };
  }

  return {
    posture: 'within_current_authority_range',
    note: `Within current authority range — the current backlink footprint (${backlinkProfile.referringDomains.toLocaleString()} referring domains) is a realistic fit for KD ${difficulty}.`,
    referringDomains: backlinkProfile.referringDomains,
  };
}
