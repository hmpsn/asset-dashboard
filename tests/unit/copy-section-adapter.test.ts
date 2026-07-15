import { describe, it, expect, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { getAdapter } from '../../server/domains/inbox/deliverable-adapters/types.js';
// Importing the barrel self-registers the PR-1d copy_section adapter (+ the others).
import '../../server/domains/inbox/deliverable-adapters/index.js';
import type {
  CopyEntryProjectionInput,
  ProjectedCopyEntryPayload,
} from '../../server/domains/inbox/deliverable-adapters/copy-section.js';
import { upsertDeliverable, getDeliverable } from '../../server/client-deliverables.js';
import type {
  CopySection,
  CopyMetadata,
  CopySectionStatus,
  ClientSuggestion,
  QualityFlag,
  SteeringEntry,
} from '../../shared/types/copy-pipeline.js';

const WS = 'copy-section-adapter-test';
const BLUEPRINT = 'bp-copy-1';
const ENTRY = 'entry-copy-1';

afterEach(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

// ── Fixtures ──

function makeSection(over: Partial<CopySection> = {}): CopySection {
  return {
    id: `cs_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: WS,
    entryId: ENTRY,
    sectionPlanItemId: `spi_${Math.random().toString(36).slice(2, 8)}`,
    generatedCopy: 'Some generated copy.',
    status: 'client_review',
    aiAnnotation: 'annotation',
    aiReasoning: 'reasoning',
    steeringHistory: [],
    clientSuggestions: null,
    qualityFlags: null,
    version: 1,
    createdAt: '2026-05-30T10:00:00.000Z',
    updatedAt: '2026-05-30T11:00:00.000Z',
    ...over,
  };
}

const SUGGESTION: ClientSuggestion = {
  originalText: 'old phrase',
  suggestedText: 'new phrase',
  status: 'pending',
  reviewNote: 'tighten this',
  timestamp: '2026-05-30T11:30:00.000Z',
};

const QUALITY_FLAG: QualityFlag = {
  type: 'word_count_violation',
  message: 'too long',
  severity: 'warning',
};

const STEERING: SteeringEntry = {
  type: 'note',
  note: 'make it punchier',
  resultVersion: 2,
  timestamp: '2026-05-30T10:30:00.000Z',
};

function makeMetadata(over: Partial<CopyMetadata> = {}): CopyMetadata {
  return {
    id: `cm_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: WS,
    entryId: ENTRY,
    seoTitle: 'SEO Title',
    metaDescription: 'Meta description',
    ogTitle: 'OG Title',
    ogDescription: 'OG description',
    status: 'client_review',
    steeringHistory: [STEERING],
    createdAt: '2026-05-30T09:00:00.000Z',
    updatedAt: '2026-05-30T11:00:00.000Z',
  };
}

function makeInput(over: Partial<CopyEntryProjectionInput> = {}): CopyEntryProjectionInput {
  return {
    workspaceId: WS,
    blueprintId: BLUEPRINT,
    entryId: ENTRY,
    entryName: 'Homepage',
    sections: [makeSection()],
    metadata: makeMetadata(),
    ...over,
  };
}

// ── Registration ──

describe('copy_section adapter — registration', () => {
  it('is registered via the barrel as a projected review type with apply disabled', () => {
    const adapter = getAdapter('copy_section');
    expect(adapter.type).toBe('copy_section');
    // copy approve is TERMINAL — no auto-apply (the side-effect is voice-sample harvest).
    expect(adapter.appliesOnApprove).toBeFalsy();
    // PROJECTED type — it implements projectFromSource (the real path for copy).
    expect(typeof adapter.projectFromSource).toBe('function');
  });
});

// ── projectFromSource: the real path ──

describe('copy_section adapter — projectFromSource (the projected read path)', () => {
  it('produces an explicit client-safe ClientDeliverable from a copy entry + sections', () => {
    const adapter = getAdapter('copy_section');
    const s1 = makeSection({
      version: 3,
      status: 'revision_requested',
      clientSuggestions: [SUGGESTION],
      qualityFlags: [QUALITY_FLAG],
      steeringHistory: [STEERING],
    });
    const s2 = makeSection({ version: 1, status: 'client_review' });
    const input = makeInput({ sections: [s1, s2] });

    const deliverable = adapter.projectFromSource!(input);

    // identity + classification
    expect(deliverable.type).toBe('copy_section');
    expect(deliverable.kind).toBe('review');
    expect(deliverable.workspaceId).toBe(WS);
    expect(deliverable.externalRef).toBe(ENTRY);
    expect(deliverable.sourceRef).toBe(`copy:${ENTRY}`);

    const payload = deliverable.payload as unknown as ProjectedCopyEntryPayload;
    // blueprintId + entryId preserved
    expect(payload.family).toBe('copy_section');
    expect(payload.blueprintId).toBe(BLUEPRINT);
    expect(payload.entryId).toBe(ENTRY);
    expect(payload.sections).toHaveLength(2);

    // every section's id + sectionPlanItemId + version survive
    expect(payload.sections[0].id).toBe(s1.id);
    expect(payload.sections[0].sectionPlanItemId).toBe(s1.sectionPlanItemId);
    expect(payload.sections[0].version).toBe(3);
    expect(payload.sections[1].version).toBe(1);

    // Client-authored review artifacts survive verbatim.
    expect(payload.sections[0].clientSuggestions).toEqual([SUGGESTION]);
    // A section with null suggestions keeps null (not coerced to []).
    expect(payload.sections[1].clientSuggestions).toBeNull();

    const projectedSection = payload.sections[0] as unknown as Record<string, unknown>;
    expect(projectedSection).not.toHaveProperty('aiReasoning');
    expect(projectedSection).not.toHaveProperty('qualityFlags');
    expect(projectedSection).not.toHaveProperty('steeringHistory');
    expect(projectedSection).not.toHaveProperty('workspaceId');

    // Client-safe sibling copy_metadata is carried through without operator steering/workspace.
    expect(payload.copyMetadata).not.toBeNull();
    expect(payload.copyMetadata!.seoTitle).toBe('SEO Title');
    expect(payload.copyMetadata).not.toHaveProperty('steeringHistory');
    expect(payload.copyMetadata).not.toHaveProperty('workspaceId');
  });

  it('carries copy_metadata = null when the entry has no metadata row', () => {
    const adapter = getAdapter('copy_section');
    const deliverable = adapter.projectFromSource!(makeInput({ metadata: null }));
    const payload = deliverable.payload as unknown as ProjectedCopyEntryPayload;
    expect(payload.copyMetadata).toBeNull();
  });

  it('omits every internal generation and operator-only field from unified projections', () => {
    const section = makeSection({
      generationRevision: 7,
      generationProvenance: {
        runId: 'private-run',
        operation: 'copy-generation',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        inputFingerprint: 'a'.repeat(64),
        startedAt: '2026-07-14T00:00:00.000Z',
        completedAt: '2026-07-14T00:00:01.000Z',
      },
    });
    const deliverable = getAdapter('copy_section').projectFromSource!(
      makeInput({ sections: [section] }),
    );
    const projected = (
      (deliverable.payload as unknown as ProjectedCopyEntryPayload).sections[0]
    ) as unknown as Record<string, unknown>;
    expect(projected).not.toHaveProperty('generationRevision');
    expect(projected).not.toHaveProperty('generationProvenance');
    expect(projected).not.toHaveProperty('aiReasoning');
    expect(projected).not.toHaveProperty('qualityFlags');
    expect(projected).not.toHaveProperty('steeringHistory');
    expect(projected).not.toHaveProperty('workspaceId');
    expect(JSON.stringify(deliverable)).not.toContain('private-run');
    expect(JSON.stringify(deliverable)).not.toContain('reasoning');
    expect(JSON.stringify(deliverable)).not.toContain('make it punchier');
  });

  it('carries the entry generatedAt = most-recent section update (not "now")', () => {
    const adapter = getAdapter('copy_section');
    const input = makeInput({
      sections: [
        makeSection({ updatedAt: '2026-05-30T11:00:00.000Z' }),
        makeSection({ updatedAt: '2026-05-31T12:00:00.000Z' }),
      ],
    });
    const deliverable = adapter.projectFromSource!(input);
    expect(deliverable.generatedAt).toBe('2026-05-31T12:00:00.000Z');
  });
});

// ── status mapping (per-section + entry rollup) ──

describe('copy_section adapter — status mapping (copy → canonical)', () => {
  const adapter = getAdapter('copy_section');

  const cases: Array<[CopySectionStatus, string]> = [
    ['client_review', 'awaiting_client'],
    ['revision_requested', 'changes_requested'],
    ['approved', 'approved'],
    ['draft', 'draft'],
    ['pending', 'draft'],
  ];

  it.each(cases)('per-section status %s maps to %s', (copyStatus, expected) => {
    const deliverable = adapter.projectFromSource!(makeInput({ sections: [makeSection({ status: copyStatus })] }));
    const payload = deliverable.payload as unknown as ProjectedCopyEntryPayload;
    expect(payload.sections[0].status).toBe(copyStatus); // raw status preserved
    expect(payload.sections[0].deliverableStatus).toBe(expected); // canonical alongside
  });

  it('entry rollup: any revision_requested section → changes_requested', () => {
    const deliverable = adapter.projectFromSource!(
      makeInput({ sections: [makeSection({ status: 'approved' }), makeSection({ status: 'revision_requested' })] }),
    );
    expect(deliverable.status).toBe('changes_requested');
  });

  it('entry rollup: all sections approved → approved (terminal)', () => {
    const deliverable = adapter.projectFromSource!(
      makeInput({ sections: [makeSection({ status: 'approved' }), makeSection({ status: 'approved' })] }),
    );
    expect(deliverable.status).toBe('approved');
  });

  it('entry rollup: all sections in client_review → awaiting_client', () => {
    const deliverable = adapter.projectFromSource!(
      makeInput({ sections: [makeSection({ status: 'client_review' }), makeSection({ status: 'client_review' })] }),
    );
    expect(deliverable.status).toBe('awaiting_client');
  });
});

// ── sourceRef (stable per-entry) ──

describe('copy_section adapter — sourceRef (stable per-entry)', () => {
  it('sourceRef → copy:<entryId>', () => {
    expect(getAdapter('copy_section').sourceRef(makeInput())).toBe(`copy:${ENTRY}`);
  });

  it('sourceRef is null when the entry has no entryId', () => {
    expect(getAdapter('copy_section').sourceRef(makeInput({ entryId: '' }))).toBeNull();
  });

  it('sourceRef is STABLE across two projections of the same entry', () => {
    const adapter = getAdapter('copy_section');
    const a = adapter.sourceRef(makeInput({ sections: [makeSection({ version: 1 })] }));
    const b = adapter.sourceRef(makeInput({ sections: [makeSection({ version: 5 })] }));
    expect(a).toBe(b);
  });
});

// ── validateSendable ──

describe('copy_section adapter — validateSendable', () => {
  const adapter = getAdapter('copy_section');

  it('an entry with a draft section IS sendable', () => {
    expect(adapter.validateSendable(makeInput({ sections: [makeSection({ status: 'draft' })] }))).toEqual({ ok: true });
  });

  it('an entry with a client_review section IS sendable', () => {
    expect(adapter.validateSendable(makeInput({ sections: [makeSection({ status: 'client_review' })] }))).toEqual({ ok: true });
  });

  it('rejects an entry with no sendable sections (only pending/approved)', () => {
    const res = adapter.validateSendable(
      makeInput({ sections: [makeSection({ status: 'pending' }), makeSection({ status: 'approved' })] }),
    );
    expect(res).toEqual({
      ok: false,
      reason: 'copy entry has no sendable sections (no draft or client_review section to review)',
    });
  });

  it('rejects an entry with no sections at all', () => {
    expect(adapter.validateSendable(makeInput({ sections: [] })).ok).toBe(false);
  });
});

// ── buildPayload (interface completeness — not copy's real send path) ──

describe('copy_section adapter — buildPayload (interface completeness)', () => {
  it('builds a kind:review payload with NO child items (per-section detail rides in payload.sections[])', () => {
    const built = getAdapter('copy_section').buildPayload(makeInput());
    expect(built.kind).toBe('review');
    expect(built.items).toBeUndefined();
    expect(built.externalRef).toBe(ENTRY);
    const payload = built.payload as unknown as ProjectedCopyEntryPayload;
    expect(payload.family).toBe('copy_section');
    expect(payload.sections).toHaveLength(1);
  });
});

// ── apply disabled (D-apply, terminal approve) ──

describe('copy_section adapter — apply stays disabled (terminal approve)', () => {
  it('apply stub throws (copy approve is terminal; voice-sample harvest lives in source path)', async () => {
    const adapter = getAdapter('copy_section');
    await expect(adapter.applyDeliverable!({} as never)).rejects.toThrow(
      /disabled|terminal|D-apply|voice-sample/i,
    );
  });
});

// ── optional: prove the projected shape survives a store round-trip ──
// Projection is normally read-time-only (no physical row for a projected type). This case only
// proves the explicit safe payload SHAPE persists through upsertDeliverable — it does NOT imply
// copy dual-writes or authorize persisting internal source fields.

describe('copy_section adapter — projected payload survives a store round-trip (shape only)', () => {
  it('round-trips the projected client-safe payload through upsertDeliverable', () => {
    const adapter = getAdapter('copy_section');
    const s1 = makeSection({
      version: 4,
      status: 'revision_requested',
      clientSuggestions: [SUGGESTION],
      qualityFlags: [QUALITY_FLAG],
      steeringHistory: [STEERING],
    });
    const input = makeInput({ sections: [s1] });
    const built = adapter.buildPayload(input);

    const stored = upsertDeliverable({
      workspaceId: WS,
      type: 'copy_section',
      kind: built.kind,
      status: 'changes_requested',
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      externalRef: built.externalRef ?? null,
      sourceRef: adapter.sourceRef(input),
      source: 'copy_pipeline',
    });

    const got = getDeliverable(stored.id)!;
    expect(got.type).toBe('copy_section');
    expect(got.kind).toBe('review');
    // assert-no-fallback: the payload round-trips the real content, not {}.
    expect(got.payload).not.toEqual({});
    const payload = got.payload as unknown as ProjectedCopyEntryPayload;
    expect(payload.family).toBe('copy_section');
    expect(payload.blueprintId).toBe(BLUEPRINT);
    expect(payload.entryId).toBe(ENTRY);
    expect(payload.sections[0].version).toBe(4);
    expect(payload.sections[0].clientSuggestions).toEqual([SUGGESTION]);
    expect(payload.sections[0]).not.toHaveProperty('qualityFlags');
    expect(payload.sections[0]).not.toHaveProperty('steeringHistory');
    expect(payload.sections[0]).not.toHaveProperty('aiReasoning');
    expect(payload.copyMetadata).not.toHaveProperty('steeringHistory');
    expect(JSON.stringify(payload)).not.toContain('make it punchier');
    // no typed child items written for this projected review type
    expect(got.items ?? []).toHaveLength(0);
  });

  it('a second projection of the same entry dedupes onto one row (stable sourceRef)', () => {
    const adapter = getAdapter('copy_section');
    const store = (sections: CopySection[]) => {
      const input = makeInput({ sections });
      const built = adapter.buildPayload(input);
      return upsertDeliverable({
        workspaceId: WS,
        type: 'copy_section',
        kind: built.kind,
        status: 'awaiting_client',
        title: built.title,
        payload: built.payload,
        externalRef: built.externalRef ?? null,
        sourceRef: adapter.sourceRef(input),
      });
    };
    const first = store([makeSection({ version: 1 })]);
    const second = store([makeSection({ version: 2 })]);
    expect(second.id).toBe(first.id); // deduped onto one row
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM client_deliverable WHERE workspace_id = ? AND type = ?')
      .get(WS, 'copy_section') as { n: number };
    expect(rows.n).toBe(1);
  });
});
