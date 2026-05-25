import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function readProjectFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8'); // readFile-ok - contract test inspects background-generation wiring.
}

describe('BrandHub background generation contract', () => {
  it('registers BrandHub context generation as explicit background job types', () => {
    const source = readProjectFile('shared/types/background-jobs.ts');

    expect(source).toContain("KNOWLEDGE_BASE_GENERATION: 'knowledge-base-generation'");
    expect(source).toContain("BRAND_VOICE_GENERATION: 'brand-voice-generation'");
    expect(source).toContain("PERSONA_GENERATION: 'persona-generation'");
    expect(source).toContain('prepares a knowledge base draft for review');
    expect(source).toContain('prepares a brand voice draft for review');
    expect(source).toContain('prepares audience persona drafts for review');
  });

  it('routes workspace context generation through the jobs dispatcher and shared worker', () => {
    const jobsSource = readProjectFile('server/routes/jobs.ts');
    const workspaceRoutesSource = readProjectFile('server/routes/workspaces.ts');

    expect(jobsSource).toContain('startWorkspaceContextGenerationJob(type, wsId)');
    expect(jobsSource).toContain('BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION');
    expect(jobsSource).toContain('BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION');
    expect(jobsSource).toContain('BACKGROUND_JOB_TYPES.PERSONA_GENERATION');
    expect(workspaceRoutesSource).toContain('startWorkspaceContextGenerationJob(BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION');
    expect(workspaceRoutesSource).toContain('startWorkspaceContextGenerationJob(BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION');
    expect(workspaceRoutesSource).toContain('startWorkspaceContextGenerationJob(BACKGROUND_JOB_TYPES.PERSONA_GENERATION');
  });

  it('keeps BrandHub generation buttons on useBackgroundTasks rather than direct workspace generation APIs', () => {
    const source = readProjectFile('src/components/BrandHub.tsx');

    expect(source).toContain('useBackgroundTasks');
    expect(source).toContain('startJob(BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION');
    expect(source).toContain('startJob(BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION');
    expect(source).toContain('startJob(BACKGROUND_JOB_TYPES.PERSONA_GENERATION');
    expect(source).not.toContain('workspaces.generateKnowledgeBase');
    expect(source).not.toContain('workspaces.generateBrandVoice');
    expect(source).not.toContain('workspaces.generatePersonas');
  });

  it('recovers in-flight BrandHub generation jobs after navigating away and back', () => {
    const source = readProjectFile('src/components/BrandHub.tsx');

    expect(source).toContain('readStoredContextJobId(workspaceId, BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION)');
    expect(source).toContain('storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION, jobId)');
    expect(source).toContain('storeContextJobId(workspaceId, BACKGROUND_JOB_TYPES.PERSONA_GENERATION, null)');
  });

  it('flags invalid BrandHub regression when direct workspace generation APIs reappear', () => {
    const source = readProjectFile('src/components/BrandHub.tsx');

    expect(source).not.toMatch(/workspaces\.(generateKnowledgeBase|generateBrandVoice|generatePersonas)\s*\(/);
    expect(source).toContain('startJob(BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION');
    expect(source).toContain('startJob(BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION');
    expect(source).toContain('startJob(BACKGROUND_JOB_TYPES.PERSONA_GENERATION');
  });
});
