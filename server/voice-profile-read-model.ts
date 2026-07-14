import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { z } from './middleware/validate.js';
import { VOICE_SAMPLE_SOURCES } from '../shared/types/brand-engine.js';
import type {
  ContextModifier,
  VoiceDNA,
  VoiceGuardrails,
  VoiceProfile,
  VoiceProfileStatus,
  VoiceSample,
  VoiceSampleContext,
  VoiceSampleSource,
} from '../shared/types/brand-engine.js';

interface ProfileRow {
  id: string; workspace_id: string; status: string;
  revision: number;
  voice_dna_json: string | null; guardrails_json: string | null;
  context_modifiers_json: string | null; created_at: string; updated_at: string;
}

interface SampleRow {
  id: string; voice_profile_id: string; content: string;
  context_tag: string | null; source: string | null;
  sort_order: number | null; created_at: string;
}

// Mutable legacy rows intentionally mirror the PATCH storage contract. The
// finalizer applies the stricter substantive-DNA/guardrail contract only when
// locking an immutable snapshot.
const storedVoiceDNASchema = z.object({
  personalityTraits: z.array(z.string()),
  toneSpectrum: z.object({
    formal_casual: z.number().min(1).max(10),
    serious_playful: z.number().min(1).max(10),
    technical_accessible: z.number().min(1).max(10),
  }),
  sentenceStyle: z.string(),
  vocabularyLevel: z.string(),
  humorStyle: z.string().optional(),
});

const storedVoiceGuardrailsSchema = z.object({
  forbiddenWords: z.array(z.string()),
  requiredTerminology: z.array(z.object({ use: z.string(), insteadOf: z.string() })),
  toneBoundaries: z.array(z.string()),
  antiPatterns: z.array(z.string()),
});

const storedContextModifierSchema = z.object({
  context: z.string(),
  description: z.string(),
});

const stmts = createStmtCache(() => ({
  getProfileByWorkspace: db.prepare(`SELECT * FROM voice_profiles WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1`),
  listSamples: db.prepare(`SELECT * FROM voice_samples WHERE voice_profile_id = ? ORDER BY sort_order`),
}));

function rowToProfile(row: ProfileRow): Omit<VoiceProfile, 'samples'> {
  const status: VoiceProfileStatus = row.status === 'draft'
    || row.status === 'calibrating'
    || row.status === 'calibrated'
    ? row.status
    : (() => { throw new Error(`Invalid stored voice profile status: ${row.status}`); })();
  return {
    id: row.id, workspaceId: row.workspace_id,
    revision: row.revision,
    status,
    voiceDNA: row.voice_dna_json
      ? parseJsonSafe<VoiceDNA, null>(
          row.voice_dna_json,
          storedVoiceDNASchema,
          null,
          { workspaceId: row.workspace_id, table: 'voice_profiles', field: 'voice_dna_json' },
        ) ?? undefined
      : undefined,
    guardrails: row.guardrails_json
      ? parseJsonSafe<VoiceGuardrails, null>(
          row.guardrails_json,
          storedVoiceGuardrailsSchema,
          null,
          { workspaceId: row.workspace_id, table: 'voice_profiles', field: 'guardrails_json' },
        ) ?? undefined
      : undefined,
    contextModifiers: row.context_modifiers_json
      ? parseJsonSafeArray<ContextModifier>(
          row.context_modifiers_json,
          storedContextModifierSchema,
          { workspaceId: row.workspace_id, table: 'voice_profiles', field: 'context_modifiers_json' },
        )
      : undefined,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToSample(row: SampleRow): VoiceSample {
  const contextTag = row.context_tag === 'headline'
    || row.context_tag === 'body'
    || row.context_tag === 'cta'
    || row.context_tag === 'about'
    || row.context_tag === 'service'
    || row.context_tag === 'social'
    || row.context_tag === 'seo'
    ? row.context_tag
    : undefined;
  const source = VOICE_SAMPLE_SOURCES.find(candidate => candidate === row.source);
  return {
    id: row.id, voiceProfileId: row.voice_profile_id, content: row.content,
    contextTag: contextTag as VoiceSampleContext | undefined,
    source: source as VoiceSampleSource | undefined,
    sortOrder: row.sort_order ?? undefined, createdAt: row.created_at,
  };
}

export function getVoiceProfile(workspaceId: string): (VoiceProfile & { samples: VoiceSample[] }) | null {
  const row = stmts().getProfileByWorkspace.get(workspaceId) as ProfileRow | undefined;
  if (!row) return null;
  const profile = rowToProfile(row);
  const samples = (stmts().listSamples.all(row.id) as SampleRow[]).map(rowToSample);
  return { ...profile, samples };
}
