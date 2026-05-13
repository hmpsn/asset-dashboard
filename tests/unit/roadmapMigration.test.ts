import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function loadRoadmap(file: string) {
  const raw = fs.readFileSync(path.resolve(file), 'utf-8');
  return JSON.parse(raw) as { sprints: Array<{ id: string; items: Array<{ status: string }> }> };
}

describe('roadmap data integrity', () => {
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
