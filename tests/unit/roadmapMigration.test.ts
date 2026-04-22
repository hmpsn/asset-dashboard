import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function loadRoadmap() {
  const raw = fs.readFileSync(path.resolve('data/roadmap.json'), 'utf-8');
  return JSON.parse(raw) as { sprints: Array<{ id: string; items: Array<{ status: string }> }> };
}

describe('roadmap data integrity', () => {
  it('shipped-earlier sprint has no pending items', () => {
    const { sprints } = loadRoadmap();
    const earlier = sprints.find(s => s.id === 'shipped-earlier');
    expect(earlier, 'shipped-earlier sprint must exist').toBeDefined();
    const pending = earlier!.items.filter(i => i.status === 'pending');
    expect(pending, 'no pending items should remain in shipped-earlier').toHaveLength(0);
  });
});
