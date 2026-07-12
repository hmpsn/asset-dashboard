import { z } from 'zod';

import { parseStructuredAIOutput } from '../ai-structured-output.js';

const nonemptyString = z.string().trim().min(1);

const brandscriptImportOutputSchema = z.object({
  frameworkType: z.enum(['storybrand', 'custom']),
  sections: z.array(z.object({
    title: nonemptyString,
    purpose: nonemptyString,
    content: nonemptyString,
  }).strict()).min(1),
}).strict();

const brandscriptCompletionSectionSchema = z.object({
  title: nonemptyString,
  content: nonemptyString,
}).strict();

const voiceCalibrationOutputSchema = z.object({
  variations: z.tuple([nonemptyString, nonemptyString, nonemptyString]),
}).strict();

const voiceRefinementOutputSchema = z.object({
  refined: nonemptyString,
}).strict();

const voicePatternExtractionSchema = z.object({
  extraction_type: z.literal('voice_pattern'),
  category: z.enum([
    'signature_phrase',
    'vocabulary',
    'tone_marker',
    'metaphor',
    'sentence_pattern',
  ]),
  content: nonemptyString,
  source_quote: nonemptyString.optional(),
}).strict();

const storyElementExtractionSchema = z.object({
  extraction_type: z.literal('story_element'),
  category: z.enum([
    'origin_story',
    'customer_problem',
    'solution_framing',
    'authority_marker',
    'empathy_signal',
    'success_story',
    'values_in_action',
  ]),
  content: nonemptyString,
  source_quote: nonemptyString.optional(),
}).strict();

const discoveryExtractionOutputSchema = z.object({
  // A valid empty array is an intentional "nothing reusable found" result.
  // The envelope remains required so malformed output never marks a source done.
  extractions: z.array(z.discriminatedUnion('extraction_type', [
    voicePatternExtractionSchema,
    storyElementExtractionSchema,
  ])),
}).strict();

export function parseBrandscriptImportOutput(raw: string) {
  return parseStructuredAIOutput(raw, brandscriptImportOutputSchema, 'brandscript-import');
}

export function parseBrandscriptCompletionOutput(raw: string, expectedTitles: string[]) {
  const expectedCounts = new Map<string, number>();
  for (const title of expectedTitles) {
    expectedCounts.set(title, (expectedCounts.get(title) ?? 0) + 1);
  }

  const schema = z.object({
    sections: z.array(brandscriptCompletionSectionSchema),
  }).strict().superRefine((output, ctx) => {
    const actualCounts = new Map<string, number>();
    for (const section of output.sections) {
      actualCounts.set(section.title, (actualCounts.get(section.title) ?? 0) + 1);
    }

    const allTitles = new Set([...expectedCounts.keys(), ...actualCounts.keys()]);
    for (const title of allTitles) {
      const expected = expectedCounts.get(title) ?? 0;
      const actual = actualCounts.get(title) ?? 0;
      if (actual !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected ${expected} completion draft(s) for title "${title}", received ${actual}`,
          path: ['sections'],
        });
      }
    }

    if (output.sections.length === expectedTitles.length) {
      output.sections.forEach((section, index) => {
        if (section.title !== expectedTitles[index]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Expected completion title "${expectedTitles[index]}" at index ${index}, received "${section.title}"`,
            path: ['sections', index, 'title'],
          });
        }
      });
    }
  });

  return parseStructuredAIOutput(raw, schema, 'brandscript-complete');
}

export function parseVoiceCalibrationOutput(raw: string) {
  return parseStructuredAIOutput(raw, voiceCalibrationOutputSchema, 'voice-calibration');
}

export function parseVoiceRefinementOutput(raw: string) {
  return parseStructuredAIOutput(raw, voiceRefinementOutputSchema, 'voice-refinement');
}

export function parseDiscoveryExtractionOutput(raw: string) {
  return parseStructuredAIOutput(raw, discoveryExtractionOutputSchema, 'discovery-extraction');
}
