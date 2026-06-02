import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';
// The barrel self-registers the schema_plan adapter the backfill resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import {
  backfillSchemaPlanDeliverables,
  findSiteWorkspaceConflicts,
} from '../../scripts/backfill-deliverables-schema-plan.js';
import { saveSchemaPlan } from '../../server/schema-store.js';
import { listDeliverables } from '../../server/client-deliverables.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { setFlagOverride } from '../../server/feature-flags.js';
import {
  mirrorSchemaPlanToDeliverable,
  SCHEMA_PLAN_FLAG,
} from '../../server/domains/inbox/schema-plan-dual-write.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';

const wsA = createWorkspace('backfill-schema-plan-A', 'site-bsp-a');
const wsB = createWorkspace('backfill-schema-plan-B', 'site-bsp-b');
const WS_A = wsA.id;
const WS_B = wsB.id;
const SITE_A = 'site-bsp-a';
const SITE_B = 'site-bsp-b';

function plan(over: Partial<SchemaSitePlan> = {}): SchemaSitePlan {
  return {
    id: `plan_${Math.random().toString(36).slice(2, 10)}`,
    siteId: SITE_A,
    workspaceId: WS_A,
    siteUrl: 'https://example.com',
    canonicalEntities: [
      { type: 'Organization', name: 'Ex', canonicalUrl: 'https://example.com', id: 'https://example.com/#org' },
    ],
    pageRoles: [
      { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [] },
    ],
    status: 'sent_to_client',
    generatedAt: '2026-05-30T12:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  // backfillSchemaPlanDeliverables() reads ALL schema_site_plans (the cutover tool scans the
  // whole table). Start from an empty table so `total`/`conflicts` counts reflect only this
  // test's seeded plans (the worker DB is isolated, so this never affects other workers).
  db.prepare('DELETE FROM schema_site_plans').run();
});

afterEach(() => {
  setFlagOverride(SCHEMA_PLAN_FLAG, null);
  db.prepare('DELETE FROM schema_site_plans').run();
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id IN (?, ?)').run(WS_A, WS_B);
});

afterAll(() => {
  db.prepare('DELETE FROM schema_site_plans WHERE workspace_id IN (?, ?)').run(WS_A, WS_B);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id IN (?, ?)').run(WS_A, WS_B);
  deleteWorkspace(WS_A);
  deleteWorkspace(WS_B);
});

describe('backfill-deliverables-schema-plan', () => {
  it('backfills a sent plan into a schema_plan deliverable with the stable sourceRef', () => {
    saveSchemaPlan(plan());
    const result = backfillSchemaPlanDeliverables();
    expect(result.total).toBe(1);
    expect(result.inserted).toBe(1);

    const rows = listDeliverables(WS_A).filter((r) => r.type === 'schema_plan');
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceRef).toBe(`schema_plan:${SITE_A}`);
    expect(rows[0].kind).toBe('review');
    expect(rows[0].externalRef).toBe(SITE_A);
    expect(rows[0].generatedAt).toBe('2026-05-30T12:00:00.000Z');
  });

  it('skips a draft plan (never sent → nothing to mirror)', () => {
    saveSchemaPlan(plan({ status: 'draft' }));
    const result = backfillSchemaPlanDeliverables();
    expect(result.total).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(listDeliverables(WS_A)).toHaveLength(0);
  });

  it('is idempotent — re-running the backfill inserts nothing new', () => {
    saveSchemaPlan(plan());
    const first = backfillSchemaPlanDeliverables();
    expect(first.inserted).toBe(1);

    const second = backfillSchemaPlanDeliverables();
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(1);
    expect(listDeliverables(WS_A).filter((r) => r.type === 'schema_plan')).toHaveLength(1);
  });

  it('--dry-run counts but writes nothing', () => {
    saveSchemaPlan(plan());
    const result = backfillSchemaPlanDeliverables({ dryRun: true });
    expect(result.total).toBe(1);
    expect(result.inserted).toBe(1); // would-insert count
    expect(listDeliverables(WS_A)).toHaveLength(0); // but nothing written
  });

  it('maps client_approved → approved and active → applied', () => {
    saveSchemaPlan(plan({ siteId: SITE_A, workspaceId: WS_A, status: 'client_approved' }));
    saveSchemaPlan(plan({ siteId: SITE_B, workspaceId: WS_B, status: 'active' }));
    backfillSchemaPlanDeliverables();
    const a = listDeliverables(WS_A).find((r) => r.type === 'schema_plan')!;
    const b = listDeliverables(WS_B).find((r) => r.type === 'schema_plan')!;
    expect(a.status).toBe('approved');
    expect(b.status).toBe('applied');
  });

  it('CROSS-PATH: a dual-written deliverable + a backfill of the same site collapse to ONE', () => {
    setFlagOverride(SCHEMA_PLAN_FLAG, true);
    // Fresh send via DUAL-WRITE → one schema_plan:<siteId> deliverable.
    const mirrored = mirrorSchemaPlanToDeliverable(WS_A, plan({ id: 'plan_fresh' }));
    expect(mirrored!.sourceRef).toBe(`schema_plan:${SITE_A}`);
    expect(listDeliverables(WS_A).filter((r) => r.type === 'schema_plan')).toHaveLength(1);

    // A historical plan row for the SAME site is stored, then BACKFILL runs.
    saveSchemaPlan(plan({ id: 'plan_historical' }));
    const result = backfillSchemaPlanDeliverables();
    // Normalizes to schema_plan:<siteId>, which already exists → no new row.
    expect(result.inserted).toBe(0);
    expect(listDeliverables(WS_A).filter((r) => r.type === 'schema_plan')).toHaveLength(1);
  });

  it('detects a not-1:1 site→workspace mapping and skips the conflicting rows', () => {
    // Same siteId under two different workspaces (a not-1:1 anomaly). findSiteWorkspaceConflicts
    // flags it; the backfill skips both rows rather than guessing the owner.
    const plans: SchemaSitePlan[] = [
      plan({ id: 'p1', siteId: 'shared-site', workspaceId: WS_A }),
      plan({ id: 'p2', siteId: 'shared-site', workspaceId: WS_B }),
    ];
    const conflicts = findSiteWorkspaceConflicts(plans);
    expect(conflicts.has('shared-site')).toBe(true);

    // Persist them and run the real backfill — the conflicting rows are skipped.
    saveSchemaPlan(plans[0]);
    saveSchemaPlan(plans[1]);
    const result = backfillSchemaPlanDeliverables();
    expect(result.conflicts).toBe(2);
    expect(listDeliverables(WS_A).filter((r) => r.payload.siteId === 'shared-site')).toHaveLength(0);
    expect(listDeliverables(WS_B).filter((r) => r.payload.siteId === 'shared-site')).toHaveLength(0);
  });

  it('no conflict when every siteId maps to exactly one workspace', () => {
    const plans: SchemaSitePlan[] = [
      plan({ siteId: SITE_A, workspaceId: WS_A }),
      plan({ siteId: SITE_B, workspaceId: WS_B }),
    ];
    expect(findSiteWorkspaceConflicts(plans).size).toBe(0);
  });
});
