import fs from 'node:fs';
import path from 'node:path';
import { getWorkspace } from '../workspaces.js';
import { getUploadRoot } from '../data-dir.js';
import { getVoiceProfile } from '../voice-calibration.js';
import { createLogger } from '../logger.js';
import { isProgrammingError } from '../errors.js';
import { renderVoiceDNAForPrompt, renderVoiceDNASummary } from '../voice-dna-render.js';
import type { ContextEmphasis, VoiceProfile, VoiceSample } from '../../shared/types/brand-engine.js';

const log = createLogger('workspace-intelligence/seo-context-source');
const MISSING_SCHEMA_ERROR_RE = /no such (table|column)/i;

function safeBrandEngineRead<T>(context: string, workspaceId: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!MISSING_SCHEMA_ERROR_RE.test(message)) throw err;
    log.warn({ context, workspaceId, error: message }, 'brand-engine read failed — graceful degradation to legacy path');
    return fallback;
  }
}

function readWorkspaceDocs(workspaceFolder: string, folder: 'brand-docs' | 'knowledge-docs', limit: number): string {
  const dir = path.join(getUploadRoot(), workspaceFolder, folder);
  if (!fs.existsSync(dir)) return '';

  try {
    const files = fs.readdirSync(dir).filter(f => /\.(txt|md)$/i.test(f)).sort();
    if (files.length === 0) return '';

    let content = '';
    for (const file of files) {
      const text = fs.readFileSync(path.join(dir, file), 'utf-8').trim();
      if (text) content += `--- ${file} ---\n${text}\n\n`;
      if (content.length > limit) break;
    }
    return content.slice(0, limit);
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err, folder }, 'seo context doc read programming error');
    return '';
  }
}

export function getRawBrandVoice(workspaceId: string): string {
  const ws = getWorkspace(workspaceId);
  if (!ws) return '';
  const voiceParts: string[] = [];
  if (ws.brandVoice) voiceParts.push(ws.brandVoice);
  const brandDocsContent = readWorkspaceDocs(ws.folder, 'brand-docs', 4000);
  if (brandDocsContent) voiceParts.push(brandDocsContent);
  return voiceParts.join('\n\n');
}

export function getRawKnowledge(workspaceId: string): string {
  const ws = getWorkspace(workspaceId);
  if (!ws) return '';
  const parts: string[] = [];
  if (ws.knowledgeBase?.trim()) parts.push(ws.knowledgeBase.trim());
  const docsContent = readWorkspaceDocs(ws.folder, 'knowledge-docs', 6000);
  if (docsContent) parts.push(docsContent);
  return parts.join('\n\n');
}

function buildLegacyBrandVoiceBlock(workspaceId: string): string {
  const raw = getRawBrandVoice(workspaceId);
  if (!raw) return '';
  return `\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\n${raw}`;
}

function isVoiceProfileAuthoritative(profile: VoiceProfile | null, voiceProfileBlock: string): boolean {
  if (profile === null) return false;
  if (profile.status === 'calibrated') return true;
  const hasExplicitConfig = profile.voiceDNA != null || profile.guardrails != null;
  return hasExplicitConfig && voiceProfileBlock.length > 0; // voice-authority-ok — helper body is the canonical authority site
}

function buildVoiceProfileContext(
  workspaceId: string,
  emphasis: ContextEmphasis = 'full',
  profileArg?: (VoiceProfile & { samples: VoiceSample[] }) | null,
): string {
  const profile = profileArg !== undefined
    ? profileArg
    : safeBrandEngineRead('buildVoiceProfileContext.fallback.getVoiceProfile', workspaceId, () => getVoiceProfile(workspaceId), null);
  if (!profile) return '';

  const isCalibrated = profile.status === 'calibrated';
  const parts: string[] = [];

  if (emphasis === 'minimal') {
    if (!profile.voiceDNA) return '';
    return `\n\nBRAND VOICE: ${renderVoiceDNASummary(profile.voiceDNA)}`;
  }

  const sampleLimit = emphasis === 'summary' ? 3 : 5;
  if (!isCalibrated && profile.voiceDNA) {
    parts.push('VOICE DNA:');
    parts.push(renderVoiceDNAForPrompt(profile.voiceDNA));
  }

  if (profile.samples.length > 0) {
    parts.push('\nVOICE SAMPLES (write like these):');
    for (const sample of profile.samples.slice(0, sampleLimit)) {
      parts.push(`  [${sample.contextTag || 'general'}] "${sample.content}"`);
    }
  }

  if (emphasis === 'full' && !isCalibrated && profile.guardrails) {
    parts.push('\nGUARDRAILS:');
    if (profile.guardrails.forbiddenWords.length) parts.push(`  Never use: ${profile.guardrails.forbiddenWords.join(', ')}`);
    if (profile.guardrails.requiredTerminology.length) parts.push(`  Required: ${profile.guardrails.requiredTerminology.map(t => `"${t.use}" not "${t.insteadOf}"`).join(', ')}`);
    if (profile.guardrails.toneBoundaries.length) parts.push(`  Boundaries: ${profile.guardrails.toneBoundaries.join('. ')}`);
  }

  if (parts.length === 0) return '';
  return `\n\nBRAND VOICE PROFILE (you MUST match this voice — do not deviate):\n${parts.join('\n')}`;
}

export function buildEffectiveBrandVoiceBlock(workspaceId: string): string {
  const legacyBrandVoiceBlock = buildLegacyBrandVoiceBlock(workspaceId);
  const profile = safeBrandEngineRead('buildEffectiveBrandVoiceBlock.getVoiceProfile', workspaceId, () => getVoiceProfile(workspaceId), null);
  const voiceProfileBlock = buildVoiceProfileContext(workspaceId, 'full', profile);
  return isVoiceProfileAuthoritative(profile, voiceProfileBlock) ? voiceProfileBlock : legacyBrandVoiceBlock;
}
