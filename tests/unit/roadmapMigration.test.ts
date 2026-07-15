import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROADMAP_STATUSES } from '../../shared/types/roadmap.js';

function loadRoadmap(file: string) {
  const raw = fs.readFileSync(path.resolve(file), 'utf-8');
  return JSON.parse(raw) as { sprints: Array<{ id: string; name?: string; shippedAt?: string; items: Array<{ status: string; shippedAt?: string; notes?: string }> }> };
}

describe('roadmap data integrity', () => {
  it('active roadmap uses only canonical shared statuses', () => {
    const { sprints } = loadRoadmap('data/roadmap.json');
    const items = sprints.flatMap(sprint => sprint.items);
    expect(items.length).toBeGreaterThan(0);
    const invalid = items.filter(item => !ROADMAP_STATUSES.includes(item.status as (typeof ROADMAP_STATUSES)[number]));
    expect(invalid).toEqual([]);
  });

  it('records shipments only for done items', () => {
    const { sprints } = loadRoadmap('data/roadmap.json');
    const falseShipments = sprints.flatMap(sprint => sprint.items)
      .filter(item => item.status !== 'done' && item.shippedAt);
    expect(falseShipments).toEqual([]);
  });

  it('closes merged, obsolete, and superseded audit dispositions without claiming shipment', () => {
    const { sprints } = loadRoadmap('data/roadmap.json');
    const auditedClosures = sprints.flatMap(sprint => sprint.items).filter(item =>
      item.status === 'closed' && (item.notes ?? '').includes('[ROADMAP VALUE AUDIT 2026-07-12]'),
    );
    expect(auditedClosures).toHaveLength(26);
    const invalidClosures = auditedClosures.filter(item =>
      !/\[ROADMAP VALUE AUDIT 2026-07-12\] (?:OBSOLETE-CLOSE|RESCOPE-MERGE)/.test(item.notes ?? '')
      || Boolean(item.shippedAt),
    );
    expect(invalidClosures).toEqual([]);
  });

  it('does not mark a sprint containing closed work as fully shipped', () => {
    const { sprints } = loadRoadmap('data/roadmap.json');
    const mixedTerminalSprints = sprints.filter(sprint =>
      sprint.items.some(item => item.status === 'closed')
      && !sprint.items.some(item => item.status !== 'done' && item.status !== 'closed'),
    );
    expect(mixedTerminalSprints.length).toBeGreaterThan(0);
    const falselyShippedSprints = mixedTerminalSprints.filter(sprint => sprint.name?.startsWith('✅') || sprint.shippedAt);
    expect(falselyShippedSprints).toEqual([]);
  });

  it('active roadmap does not carry monthly shipped archive buckets', () => {
    const { sprints } = loadRoadmap('data/roadmap.json');
    const archiveBuckets = sprints.filter(s => s.id.startsWith('shipped-'));
    expect(archiveBuckets, 'monthly shipped buckets belong in data/roadmap.archive.json').toHaveLength(0);
  });

  it('archived shipped-earlier sprint has no pending items', () => {
    const { sprints } = loadRoadmap('data/roadmap.archive.json');
    const earlier = sprints.find(s => s.id === 'shipped-earlier');
    expect(earlier, 'shipped-earlier sprint must exist').toBeDefined();
    const pending = earlier!.items.filter(i => i.status === 'pending');
    expect(pending, 'no pending items should remain in shipped-earlier').toHaveLength(0);
  });
});
