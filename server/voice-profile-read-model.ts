import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
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
  voice_dna_json: string | null; guardrails_json: string | null;
  context_modifiers_json: string | null; created_at: string; updated_at: string;
}

interface SampleRow {
  id: string; voice_profile_id: string; content: string;
  context_tag: string | null; source: string | null;
  sort_order: number | null; created_at: string;
}

const stmts = createStmtCache(() => ({
  getProfileByWorkspace: db.prepare(`SELECT * FROM voice_profiles WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1`),
  listSamples: db.prepare(`SELECT * FROM voice_samples WHERE voice_profile_id = ? ORDER BY sort_order`),
}));

function rowToProfile(row: ProfileRow): Omit<VoiceProfile, 'samples'> {
  return {
    id: row.id, workspaceId: row.workspace_id,
    status: row.status as VoiceProfileStatus,
    voiceDNA: row.voice_dna_json ? parseJsonFallback<VoiceDNA | null>(row.voice_dna_json, null) ?? undefined : undefined,
    guardrails: row.guardrails_json ? parseJsonFallback<VoiceGuardrails | null>(row.guardrails_json, null) ?? undefined : undefined,
    contextModifiers: row.context_modifiers_json ? parseJsonFallback<ContextModifier[] | null>(row.context_modifiers_json, null) ?? undefined : undefined,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToSample(row: SampleRow): VoiceSample {
  return {
    id: row.id, voiceProfileId: row.voice_profile_id, content: row.content,
    contextTag: (row.context_tag ?? undefined) as VoiceSampleContext | undefined,
    source: (row.source ?? undefined) as VoiceSampleSource | undefined,
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
