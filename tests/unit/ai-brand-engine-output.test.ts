import { describe, expect, it } from 'vitest';

import { StructuredAIOutputError } from '../../server/ai-structured-output.js';
import {
  parseBrandscriptCompletionOutput,
  parseBrandscriptImportOutput,
  parseDiscoveryExtractionOutput,
  parseVoiceCalibrationOutput,
  parseVoiceRefinementOutput,
} from '../../server/schemas/ai-brand-engine.js';

describe('Brand Engine structured AI output contracts', () => {
  it('accepts a complete imported brandscript and trims string fields', () => {
    expect(parseBrandscriptImportOutput(JSON.stringify({
      frameworkType: 'storybrand',
      sections: [{
        title: ' Character ',
        purpose: ' Identify the customer. ',
        content: ' Founders building their first growth engine. ',
      }],
    }))).toEqual({
      frameworkType: 'storybrand',
      sections: [{
        title: 'Character',
        purpose: 'Identify the customer.',
        content: 'Founders building their first growth engine.',
      }],
    });
  });

  it.each([
    ['malformed JSON', '{'],
    ['unknown framework', JSON.stringify({ frameworkType: 'other', sections: [{ title: 'A', purpose: 'B', content: 'C' }] })],
    ['empty sections', JSON.stringify({ frameworkType: 'custom', sections: [] })],
    ['wrong sections shape', JSON.stringify({ frameworkType: 'custom', sections: {} })],
    ['empty section content', JSON.stringify({ frameworkType: 'custom', sections: [{ title: 'A', purpose: 'B', content: '   ' }] })],
  ])('rejects imported brandscript %s', (_label, raw) => {
    expect(() => parseBrandscriptImportOutput(raw)).toThrow(StructuredAIOutputError);
  });

  it('accepts one nonempty completion draft for every requested empty section title', () => {
    expect(parseBrandscriptCompletionOutput(JSON.stringify({
      sections: [
        { title: 'Problem', content: 'Growth feels unpredictable.' },
        { title: 'Plan', content: 'Choose a package and schedule the kickoff.' },
      ],
    }), ['Problem', 'Plan'])).toEqual({
      sections: [
        { title: 'Problem', content: 'Growth feels unpredictable.' },
        { title: 'Plan', content: 'Choose a package and schedule the kickoff.' },
      ],
    });
  });

  it('preserves the requested order for repeated section titles', () => {
    expect(parseBrandscriptCompletionOutput(JSON.stringify({
      sections: [
        { title: 'Problem', content: 'The external problem.' },
        { title: 'Problem', content: 'The internal problem.' },
      ],
    }), ['Problem', 'Problem'])).toEqual({
      sections: [
        { title: 'Problem', content: 'The external problem.' },
        { title: 'Problem', content: 'The internal problem.' },
      ],
    });
  });

  it.each([
    ['malformed JSON', '{'],
    ['missing requested title', JSON.stringify({ sections: [{ title: 'Problem', content: 'A real problem.' }] })],
    ['unexpected title', JSON.stringify({ sections: [{ title: 'Problem', content: 'A real problem.' }, { title: 'Guide', content: 'A guide.' }] })],
    ['duplicate title replacing a required title', JSON.stringify({ sections: [{ title: 'Problem', content: 'First.' }, { title: 'Problem', content: 'Second.' }] })],
    ['requested titles out of order', JSON.stringify({ sections: [{ title: 'Plan', content: 'A plan.' }, { title: 'Problem', content: 'A real problem.' }] })],
    ['empty draft', JSON.stringify({ sections: [{ title: 'Problem', content: 'A real problem.' }, { title: 'Plan', content: ' ' }] })],
  ])('rejects completion output with %s', (_label, raw) => {
    expect(() => parseBrandscriptCompletionOutput(raw, ['Problem', 'Plan'])).toThrow(StructuredAIOutputError);
  });

  it('requires exactly three nonempty calibration variations', () => {
    expect(parseVoiceCalibrationOutput(JSON.stringify({
      variations: [' First direction. ', 'Second direction.', 'Third direction.'],
    }))).toEqual({
      variations: ['First direction.', 'Second direction.', 'Third direction.'],
    });

    expect(() => parseVoiceCalibrationOutput(JSON.stringify({ variations: ['One.', 'Two.'] })))
      .toThrow(StructuredAIOutputError);
    expect(() => parseVoiceCalibrationOutput(JSON.stringify({ variations: ['One.', 'Two.', '   '] })))
      .toThrow(StructuredAIOutputError);
    expect(() => parseVoiceCalibrationOutput('{')).toThrow(StructuredAIOutputError);
  });

  it('requires a nonempty voice refinement', () => {
    expect(parseVoiceRefinementOutput(JSON.stringify({ refined: ' More direct. ' })))
      .toEqual({ refined: 'More direct.' });
    expect(() => parseVoiceRefinementOutput(JSON.stringify({ refined: '   ' })))
      .toThrow(StructuredAIOutputError);
    expect(() => parseVoiceRefinementOutput('{}')).toThrow(StructuredAIOutputError);
  });

  it('accepts typed discovery extractions and intentional empty success', () => {
    expect(parseDiscoveryExtractionOutput(JSON.stringify({ extractions: [] })))
      .toEqual({ extractions: [] });
    expect(parseDiscoveryExtractionOutput(JSON.stringify({
      extractions: [{
        extraction_type: 'voice_pattern',
        category: 'signature_phrase',
        content: ' We make complicated growth decisions feel obvious. ',
        source_quote: ' Make it obvious. ',
      }],
    }))).toEqual({
      extractions: [{
        extraction_type: 'voice_pattern',
        category: 'signature_phrase',
        content: 'We make complicated growth decisions feel obvious.',
        source_quote: 'Make it obvious.',
      }],
    });
  });

  it.each([
    ['malformed JSON', '{'],
    ['wrong envelope', '{}'],
    ['unknown extraction type', JSON.stringify({ extractions: [{ extraction_type: 'other', category: 'signature_phrase', content: 'Text' }] })],
    ['unknown category', JSON.stringify({ extractions: [{ extraction_type: 'voice_pattern', category: 'other', content: 'Text' }] })],
    ['category/type mismatch', JSON.stringify({ extractions: [{ extraction_type: 'story_element', category: 'signature_phrase', content: 'Text' }] })],
    ['empty content', JSON.stringify({ extractions: [{ extraction_type: 'voice_pattern', category: 'signature_phrase', content: ' ' }] })],
  ])('rejects discovery output with %s', (_label, raw) => {
    expect(() => parseDiscoveryExtractionOutput(raw)).toThrow(StructuredAIOutputError);
  });
});
