import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const routeState = vi.hoisted(() => ({
  broadcasts: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
  broadcastFailuresRemaining: 0,
  regenerate: vi.fn(),
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    if (routeState.broadcastFailuresRemaining > 0) {
      routeState.broadcastFailuresRemaining -= 1;
      throw new Error('injected workspace broadcast failure');
    }
    routeState.broadcasts.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/copy-generation.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/copy-generation.js')>();
  return { ...actual, regenerateSection: routeState.regenerate };
});

import db from '../../server/db/index.js';
import { listActivity } from '../../server/activity-log.js';
import {
  addSteeringEntry,
  getSection,
  saveGeneratedCopy,
} from '../../server/copy-review.js';
import {
  clearCompletedJobs,
  createResourceScopedJob,
  listJobs,
  updateJob,
} from '../../server/jobs.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import {
  BACKGROUND_JOB_TYPES,
  JOB_RESOURCE_TYPES,
} from '../../shared/types/background-jobs.js';
import type { CopySectionRegenerationOptions } from '../../server/copy-generation.js';

let server: http.Server | undefined;
let baseUrl = '';
let workspaceId = '';
let blueprintId = '';
let entryId = '';
let sectionId = '';
let failAfterSteering = false;
let providerGate: { entered: Promise<void>; release: () => void } | null = null;

function createGate(): { entered: Promise<void>; release: () => void } {
  let enter: (() => void) | undefined;
  let release: (() => void) | undefined;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  return {
    entered,
    release: () => release?.(),
    wait: pending,
    markEntered: () => enter?.(),
  } as { entered: Promise<void>; release: () => void };
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function releaseWorkspaceJobs(): void {
  for (const job of listJobs(workspaceId)) {
    if (job.status === 'pending' || job.status === 'running') {
      updateJob(job.id, { status: 'error', error: 'test cleanup' });
    }
  }
  clearCompletedJobs({ workspaceId });
}

function failCopyRegenerationDoneWrites(targetWorkspaceId: string): () => void {
  const triggerName = 'test_fail_copy_regeneration_done_write';
  const escapedWorkspaceId = targetWorkspaceId.replaceAll("'", "''");
  db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
  db.exec(`
    CREATE TEMP TRIGGER ${triggerName}
    BEFORE UPDATE OF status ON jobs
    WHEN NEW.workspace_id = '${escapedWorkspaceId}'
      AND NEW.type = '${BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION}'
      AND OLD.status = 'running'
      AND NEW.status = 'done'
    BEGIN
      SELECT RAISE(ABORT, 'injected copy completion persistence failure');
    END
  `);
  return () => db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  server = http.createServer(createApp());
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

beforeEach(() => {
  const workspace = createWorkspace('Copy regeneration claim test');
  workspaceId = workspace.id;
  blueprintId = `bp_claim_${crypto.randomUUID()}`;
  entryId = `entry_claim_${crypto.randomUUID()}`;
  sectionId = `section_claim_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO site_blueprints (id, workspace_id, name, version, status, created_at, updated_at)
    VALUES (?, ?, 'Claim blueprint', 1, 'active', ?, ?)
  `).run(blueprintId, workspaceId, now, now);
  db.prepare(`
    INSERT INTO blueprint_entries (
      id, blueprint_id, name, page_type, scope, is_collection,
      section_plan_json, primary_keyword, sort_order, created_at, updated_at
    ) VALUES (?, ?, 'Claim entry', 'service', 'included', 0, ?, 'claim keyword', 0, ?, ?)
  `).run(entryId, blueprintId, JSON.stringify([{
    id: 'plan-hero',
    sectionType: 'hero',
    narrativeRole: 'hook',
    wordCountTarget: 100,
    order: 0,
  }]), now, now);
  db.prepare(`
    INSERT INTO copy_sections (
      id, workspace_id, entry_id, section_plan_item_id, generated_copy, status,
      ai_annotation, ai_reasoning, steering_history, client_suggestions, quality_flags,
      version, created_at, updated_at
    ) VALUES (?, ?, ?, 'plan-hero', 'Original copy', 'draft', NULL, NULL, '[]', NULL, NULL, 1, ?, ?)
  `).run(sectionId, workspaceId, entryId, now, now);

  routeState.broadcasts = [];
  routeState.broadcastFailuresRemaining = 0;
  routeState.regenerate.mockReset();
  failAfterSteering = false;
  providerGate = null;
  routeState.regenerate.mockImplementation(async (
    wsId: string,
    _blueprintId: string,
    _entryId: string,
    targetSectionId: string,
    note: string,
    highlight: string | undefined,
    options: CopySectionRegenerationOptions,
  ) => {
    const before = getSection(targetSectionId, wsId);
    if (!before) return null;
    const steered = addSteeringEntry(targetSectionId, wsId, {
      type: highlight ? 'highlight' : 'note',
      note,
      highlight,
      resultVersion: before.version,
    }, options.expectedRevision);
    if (!steered) return null;
    options.onSteeringAccepted?.(steered);
    const gate = providerGate as unknown as {
      entered: Promise<void>;
      release: () => void;
      wait?: Promise<void>;
      markEntered?: () => void;
    } | null;
    gate?.markEntered?.();
    if (gate?.wait) await gate.wait;
    if (failAfterSteering) return null;
    return saveGeneratedCopy(targetSectionId, wsId, {
      generatedCopy: 'Regenerated copy',
      aiAnnotation: 'Revised',
      aiReasoning: 'Steering applied',
      expectedRevision: steered.generationRevision,
    });
  });
});

afterEach(() => {
  releaseWorkspaceJobs();
  deleteWorkspace(workspaceId);
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
});

describe('copy section regeneration resource authority', () => {
  it('starts one paid regeneration for simultaneous same-entry requests', async () => {
    providerGate = createGate();
    const revision = getSection(sectionId, workspaceId)!.generationRevision;
    const path = `/api/copy/${workspaceId}/${blueprintId}/${entryId}/regenerate/${sectionId}`;
    const owner = postJson(path, { note: 'Sharper', expectedRevision: revision });
    await providerGate.entered;
    const loser = await postJson(path, { note: 'Sharper again', expectedRevision: revision });
    expect(loser.status).toBe(409);
    await expect(loser.json()).resolves.toMatchObject({
      code: 'active_job_resource_conflict',
      jobId: expect.any(String),
    });
    expect(routeState.regenerate).toHaveBeenCalledTimes(1);
    providerGate.release();
    expect((await owner).status).toBe(200);
  });

  it('rejects section regeneration while a full or batch entry owner is active', async () => {
    const owner = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION, {
      workspaceId,
      resources: [{ resourceType: JOB_RESOURCE_TYPES.COPY_ENTRY, resourceId: entryId }],
    });
    const response = await postJson(
      `/api/copy/${workspaceId}/${blueprintId}/${entryId}/regenerate/${sectionId}`,
      { note: 'Do not spend', expectedRevision: getSection(sectionId, workspaceId)!.generationRevision },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ jobId: owner.job.id });
    expect(routeState.regenerate).not.toHaveBeenCalled();
  });

  it('reports provider failure truthfully after the steering mutation and broadcasts its authority', async () => {
    failAfterSteering = true;
    const before = getSection(sectionId, workspaceId)!;
    const response = await postJson(
      `/api/copy/${workspaceId}/${blueprintId}/${entryId}/regenerate/${sectionId}`,
      { note: 'Keep this steering', expectedRevision: before.generationRevision },
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: 'generation_failed_after_steering',
      section: { generationRevision: before.generationRevision + 1 },
      jobId: expect.any(String),
    });
    expect(getSection(sectionId, workspaceId)).toMatchObject({
      generationRevision: before.generationRevision + 1,
      steeringHistory: [expect.objectContaining({ note: 'Keep this steering' })],
      generatedCopy: 'Original copy',
    });
    expect(routeState.broadcasts).toContainEqual(expect.objectContaining({
      event: WS_EVENTS.COPY_SECTION_UPDATED,
      payload: expect.objectContaining({
        action: 'regeneration_steering_saved',
        generationRevision: before.generationRevision + 1,
      }),
    }));
    const activities = listActivity(workspaceId);
    expect(activities.some(activity => activity.type === 'copy_section_edited')).toBe(true);
    expect(activities.some(activity => activity.type === 'copy_generated')).toBe(false);
    expect(listJobs(workspaceId).find(job => job.type === BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION))
      .toMatchObject({ status: 'error' });
  });

  it('returns the committed section and records completion-tracking failure when the done write fails', async () => {
    const before = getSection(sectionId, workspaceId)!;
    const removeFailure = failCopyRegenerationDoneWrites(workspaceId);
    let response: Response;

    try {
      response = await postJson(
        `/api/copy/${workspaceId}/${blueprintId}/${entryId}/regenerate/${sectionId}`,
        { note: 'Commit the copy exactly once', expectedRevision: before.generationRevision },
      );
    } finally {
      removeFailure();
    }

    expect(response.status).toBe(200);
    const body = await response.json() as {
      id: string;
      generatedCopy: string;
      generationRevision: number;
      completionTracking: {
        status: string;
        code: string;
        artifactCommitted: boolean;
        error: string;
        jobId: string;
      };
    };
    expect(body).toMatchObject({
      id: sectionId,
      generatedCopy: 'Regenerated copy',
      generationRevision: before.generationRevision + 2,
      completionTracking: {
        status: 'failed',
        code: 'completion_tracking_failed',
        artifactCommitted: true,
        error: 'injected copy completion persistence failure',
        jobId: expect.any(String),
      },
    });
    expect(getSection(sectionId, workspaceId)).toMatchObject({
      generatedCopy: 'Regenerated copy',
      generationRevision: before.generationRevision + 2,
    });
    expect(listJobs(workspaceId).find(job => job.id === body.completionTracking.jobId)).toMatchObject({
      status: 'error',
      error: 'injected copy completion persistence failure',
      message: 'Copy section committed, but completion tracking failed',
      result: {
        entryId,
        sectionId,
        status: 'draft',
        code: 'completion_tracking_failed',
        artifactCommitted: true,
        generationRevision: before.generationRevision + 2,
      },
    });
    expect(routeState.broadcasts.filter(call => call.event === WS_EVENTS.COPY_SECTION_UPDATED)).toEqual([
      expect.objectContaining({
        event: WS_EVENTS.COPY_SECTION_UPDATED,
        payload: expect.objectContaining({ action: 'regeneration_steering_saved' }),
      }),
    ]);
    const activities = listActivity(workspaceId);
    expect(activities.some(activity => activity.type === 'copy_section_edited')).toBe(true);
    expect(activities.some(activity => activity.type === 'copy_generated')).toBe(false);
  });

  it('returns the committed section and a done job when a post-commit broadcast throws', async () => {
    routeState.broadcastFailuresRemaining = 1;
    const before = getSection(sectionId, workspaceId)!;

    const response = await postJson(
      `/api/copy/${workspaceId}/${blueprintId}/${entryId}/regenerate/${sectionId}`,
      { note: 'Keep generating after the event failure', expectedRevision: before.generationRevision },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: sectionId,
      generatedCopy: 'Regenerated copy',
      generationRevision: before.generationRevision + 2,
    });
    expect(getSection(sectionId, workspaceId)).toMatchObject({
      generatedCopy: 'Regenerated copy',
      generationRevision: before.generationRevision + 2,
    });
    expect(routeState.broadcasts).toContainEqual(expect.objectContaining({
      event: WS_EVENTS.COPY_SECTION_UPDATED,
      payload: expect.objectContaining({ status: 'draft' }),
    }));
    expect(listJobs(workspaceId).find(job => job.type === BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION))
      .toMatchObject({ status: 'done' });
  });
});
