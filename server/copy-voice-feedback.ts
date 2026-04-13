/**
 * Voice Feedback Loop — classifies steering notes as content vs voice feedback,
 * and suggests voice profile updates when voice-related feedback is detected.
 *
 * Standalone module — does not auto-apply changes. Returns suggestions for review.
 */
import { callOpenAI, parseAIJson } from './openai-helpers.js';
import { getVoiceProfile } from './voice-calibration.js';
import { createLogger } from './logger.js';

const log = createLogger('copy-voice-feedback');

// ═══ TYPES ═══

export interface FeedbackClassification {
  content: string[];
  voice: string[];
}

export interface VoiceUpdateSuggestion {
  /** Suggested new guardrail to add (e.g., "Avoid corporate jargon") */
  suggestedGuardrail?: string;
  /** Suggested context modifier adjustment (e.g., "More conversational in service descriptions") */
  suggestedModifier?: string;
  /** The original notes that triggered this suggestion */
  sourceNotes: string[];
}

export interface SteeringFeedbackResult {
  classification: FeedbackClassification;
  voiceSuggestion: VoiceUpdateSuggestion | null;
}

// ═══ CLASSIFICATION ═══

/**
 * Classify an array of steering notes into content feedback vs voice feedback
 * using GPT-4.1-mini.
 *
 * Content feedback: about information, structure, facts, length, sections, flow.
 * Voice feedback: about tone, style, personality, word choice, brand voice.
 *
 * Returns empty arrays on AI failure — never throws.
 */
export async function classifySteeringFeedback(
  notes: string[],
  workspaceId?: string,
): Promise<FeedbackClassification> {
  if (notes.length === 0) {
    return { content: [], voice: [] };
  }

  const systemPrompt = `You are a feedback classifier for a copywriting system. Your job is to classify steering notes into two categories:

1. "content_feedback" — feedback about the INFORMATION, STRUCTURE, or SUBSTANCE of copy. Examples:
   - "Add more details about pricing"
   - "Make the section shorter"
   - "Include a customer testimonial"
   - "Reorganize the FAQ section"
   - "Add a call-to-action at the end"

2. "voice_feedback" — feedback about TONE, STYLE, PERSONALITY, or WORD CHOICE. Examples:
   - "Make it sound more professional"
   - "Too casual for our brand"
   - "Avoid using exclamation marks"
   - "Use simpler words"
   - "The humor feels forced"
   - "Should sound more confident"
   - "Don't use corporate jargon"

If a note contains BOTH content and voice aspects, classify it based on the PRIMARY intent. When in doubt, classify as content_feedback.

Return valid JSON with this exact structure:
{ "content_feedback": ["note1", "note2"], "voice_feedback": ["note3"] }

Every input note must appear in exactly one of the two arrays.`;

  const userPrompt = `Classify these steering notes:\n${notes.map((n, i) => `${i + 1}. "${n}"`).join('\n')}`;

  try {
    const result = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 500,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      feature: 'voice-feedback-classify',
      workspaceId,
    });

    const parsed = parseAIJson<{
      content_feedback?: string[];
      voice_feedback?: string[];
    }>(result.text);

    const contentFeedback = Array.isArray(parsed.content_feedback) ? parsed.content_feedback : [];
    const voiceFeedback = Array.isArray(parsed.voice_feedback) ? parsed.voice_feedback : [];

    log.info(
      { totalNotes: notes.length, content: contentFeedback.length, voice: voiceFeedback.length },
      'classified steering feedback',
    );

    return { content: contentFeedback, voice: voiceFeedback };
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err), noteCount: notes.length },
      'failed to classify steering feedback — returning all as content',
    );
    // Graceful degradation: treat all notes as content feedback
    return { content: [...notes], voice: [] };
  }
}

// ═══ VOICE UPDATE SUGGESTION ═══

/**
 * Given voice-related feedback notes and the current voice profile, suggest
 * a voice profile update (new guardrail or modifier adjustment).
 *
 * Returns null if:
 * - No voice feedback notes provided
 * - No voice profile exists for the workspace
 * - AI call fails
 *
 * Does NOT auto-apply changes — returns a suggestion for human review.
 */
export async function suggestVoiceProfileUpdate(
  workspaceId: string,
  voiceFeedbackNotes: string[],
): Promise<VoiceUpdateSuggestion | null> {
  if (voiceFeedbackNotes.length === 0) {
    return null;
  }

  let profile;
  try {
    profile = getVoiceProfile(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'voice_profiles table unavailable — skipping voice update suggestion');
    return null;
  }
  if (!profile) {
    log.info({ workspaceId }, 'no voice profile found — skipping voice update suggestion');
    return null;
  }

  // Build context about the current voice profile for the AI
  const currentGuardrails = profile.guardrails
    ? `Current guardrails:\n  Forbidden words: ${profile.guardrails.forbiddenWords.join(', ') || '(none)'}\n  Tone boundaries: ${profile.guardrails.toneBoundaries.join(', ') || '(none)'}\n  Anti-patterns: ${profile.guardrails.antiPatterns.join(', ') || '(none)'}`
    : 'No guardrails configured yet.';

  const currentModifiers = profile.contextModifiers
    ? `Current context modifiers:\n${profile.contextModifiers.map(m => `  - ${m.context}: ${m.description}`).join('\n')}`
    : 'No context modifiers configured yet.';

  const currentDNA = profile.voiceDNA
    ? `Current voice DNA:\n  Personality: ${profile.voiceDNA.personalityTraits.join(', ')}\n  Sentence style: ${profile.voiceDNA.sentenceStyle}\n  Vocabulary level: ${profile.voiceDNA.vocabularyLevel}${profile.voiceDNA.humorStyle ? `\n  Humor style: ${profile.voiceDNA.humorStyle}` : ''}`
    : 'No voice DNA configured yet.';

  const systemPrompt = `You analyze voice-related feedback on brand copy and suggest specific, actionable voice profile updates.

You have access to the brand's current voice profile. Based on the feedback notes, suggest ONE of:
- A new guardrail (a rule to add to the voice guardrails — something to avoid or always do)
- A modifier adjustment (refining how voice is applied in a specific context)

Only suggest an update if the feedback genuinely indicates a gap in the current voice profile. If the feedback is too vague or contradictory, return null.

Return valid JSON with this exact structure:
{ "suggestedGuardrail": "string or null", "suggestedModifier": "string or null", "reasoning": "brief explanation" }

At most ONE of suggestedGuardrail or suggestedModifier should be non-null. If neither is warranted, set both to null.`;

  const userPrompt = `Voice feedback notes from recent copy review:
${voiceFeedbackNotes.map((n, i) => `${i + 1}. "${n}"`).join('\n')}

${currentDNA}

${currentGuardrails}

${currentModifiers}

Based on these feedback notes and the current voice profile, suggest a specific voice profile update if warranted.`;

  try {
    const result = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 300,
      temperature: 0.3,
      responseFormat: { type: 'json_object' },
      feature: 'voice-feedback-suggest',
      workspaceId,
    });

    const parsed = parseAIJson<{
      suggestedGuardrail?: string | null;
      suggestedModifier?: string | null;
      reasoning?: string;
    }>(result.text);

    // If neither suggestion was made, return null
    if (!parsed.suggestedGuardrail && !parsed.suggestedModifier) {
      log.info(
        { workspaceId, noteCount: voiceFeedbackNotes.length, reasoning: parsed.reasoning },
        'no voice profile update suggested',
      );
      return null;
    }

    const suggestion: VoiceUpdateSuggestion = {
      sourceNotes: voiceFeedbackNotes,
      ...(parsed.suggestedGuardrail ? { suggestedGuardrail: parsed.suggestedGuardrail } : {}),
      ...(parsed.suggestedModifier ? { suggestedModifier: parsed.suggestedModifier } : {}),
    };

    log.info(
      {
        workspaceId,
        hasGuardrail: !!suggestion.suggestedGuardrail,
        hasModifier: !!suggestion.suggestedModifier,
        reasoning: parsed.reasoning,
      },
      'voice profile update suggested',
    );

    return suggestion;
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err), workspaceId },
      'failed to suggest voice profile update',
    );
    return null;
  }
}

// ═══ MAIN ENTRY POINT ═══

/**
 * Process steering feedback for a copy section: classify notes, then suggest
 * voice profile updates if voice feedback is detected.
 *
 * This is the main entry point for the voice feedback loop. Call it after
 * a user submits steering notes on a copy section.
 *
 * @param workspaceId - The workspace ID
 * @param sectionId - The copy section ID (logged for traceability)
 * @param steeringNotes - Array of steering note strings from the user
 * @returns Classification results and optional voice update suggestion
 */
export async function processSteeringFeedback(
  workspaceId: string,
  sectionId: string,
  steeringNotes: string[],
): Promise<SteeringFeedbackResult> {
  if (steeringNotes.length === 0) {
    return { classification: { content: [], voice: [] }, voiceSuggestion: null };
  }

  log.info(
    { workspaceId, sectionId, noteCount: steeringNotes.length },
    'processing steering feedback',
  );

  // Step 1: Classify all notes
  const classification = await classifySteeringFeedback(steeringNotes, workspaceId);

  // Step 2: If voice feedback detected, suggest profile update
  let voiceSuggestion: VoiceUpdateSuggestion | null = null;
  if (classification.voice.length > 0) {
    voiceSuggestion = await suggestVoiceProfileUpdate(workspaceId, classification.voice);
  }

  log.info(
    {
      workspaceId,
      sectionId,
      contentNotes: classification.content.length,
      voiceNotes: classification.voice.length,
      hasSuggestion: voiceSuggestion !== null,
    },
    'steering feedback processed',
  );

  return { classification, voiceSuggestion };
}
