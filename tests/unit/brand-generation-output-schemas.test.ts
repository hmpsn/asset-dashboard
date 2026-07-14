import { describe, expect, it } from 'vitest';

import {
  parseBrandDeliverableAIOutput,
  parseBrandFoundationAIOutput,
  parseBrandModelAuditAIOutput,
} from '../../server/domains/brand/generation/output-schemas.js';

const voiceDNA = {
  personalityTraits: ['Warm and direct'],
  toneSpectrum: {
    formal_casual: 7,
    serious_playful: 4,
    technical_accessible: 8,
  },
  sentenceStyle: 'Short, reassuring sentences.',
  vocabularyLevel: 'Plain language.',
};

const guardrails = {
  forbiddenWords: ['guaranteed'],
  requiredTerminology: [{ use: 'patient', insteadOf: 'customer' }],
  toneBoundaries: ['Never sound dismissive.'],
  antiPatterns: ['No invented outcomes.'],
};

describe('brand generation structured output schemas', () => {
  it('parses strict foundation, deliverable, and audit objects', () => {
    expect(parseBrandFoundationAIOutput(JSON.stringify({
      summary: 'Warm, practical, and patient-first.',
      voiceDNA,
      guardrails,
      contextModifiers: [{ context: 'CTA', description: 'Stay calm and direct.' }],
      claims: [{
        text: 'The intake asks for plain language.',
        classification: 'factual',
        evidenceKeys: ['brand-intake:brand.tone'],
      }],
      unresolvedRequirementIds: [],
    })).summary).toContain('patient-first');

    expect(parseBrandDeliverableAIOutput(JSON.stringify({
      content: 'Care that explains the next step.',
      claims: [{
        text: 'Care that explains the next step.',
        classification: 'creative_proposal',
        evidenceKeys: [],
      }],
      unresolvedRequirementIds: [],
    })).content).toContain('next step');

    expect(parseBrandModelAuditAIOutput(JSON.stringify({
      findings: [],
      revisionRecommended: false,
      rationale: 'No model-level issue found.',
    }))).toMatchObject({ revisionRecommended: false });
  });

  it('rejects malformed JSON and undeclared fields instead of stripping them', () => {
    expect(() => parseBrandDeliverableAIOutput('{not-json')).toThrow();
    expect(() => parseBrandDeliverableAIOutput(JSON.stringify({
      content: 'Draft',
      claims: [],
      unresolvedRequirementIds: [],
      surprise: 'must fail closed',
    }))).toThrow();
  });

  it('requires evidence keys for every factual claim', () => {
    expect(() => parseBrandDeliverableAIOutput(JSON.stringify({
      content: 'We have served 10,000 patients.',
      claims: [{
        text: 'We have served 10,000 patients.',
        classification: 'factual',
        evidenceKeys: [],
      }],
      unresolvedRequirementIds: [],
    }))).toThrow();
  });
});
