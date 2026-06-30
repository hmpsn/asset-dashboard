import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../..');

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8'); // readFile-ok
}

describe('content polish sweep contracts', () => {
  it('uses the shared status badge registry for admin content request statuses', () => {
    const requestList = read('src/components/briefs/RequestList.tsx');
    const statusConfig = read('src/components/ui/statusConfig.ts');

    expect(requestList).toContain('StatusBadge');
    expect(requestList).toContain('domain="content-admin"');
    expect(requestList).not.toContain('const statusConfig: Record<string');
    expect(requestList).not.toContain('text-cyan-400');

    expect(statusConfig).toContain("| 'content-admin'");
    expect(statusConfig).toContain("'content-admin':");
    expect(statusConfig).toContain("client_review: { label: 'Client Review', tone: 'teal' }");
    expect(statusConfig).toContain("post_review: { label: 'Post Review', tone: 'teal' }");
  });

  it('keeps brief row actions keyboard discoverable, not hover-only', () => {
    const briefList = read('src/components/briefs/BriefList.tsx');

    expect(briefList).toContain('group-hover/brief:opacity-100');
    expect(briefList).toContain('group-focus-within/brief:opacity-100');
  });

  it('keeps the content pipeline guide FAB above bottom-right overlays', () => {
    const pipeline = read('src/components/ContentPipeline.tsx');

    expect(pipeline).toContain('fixed bottom-24 right-6');
    expect(pipeline).not.toContain('fixed bottom-6 right-6');
  });

  it('delays content brief/request deletes and exposes an undo path', () => {
    const hook = read('src/hooks/admin/useAdminBriefWorkflow.ts');
    const component = read('src/components/ContentBriefs.tsx');

    expect(hook).toContain('pendingDelete');
    expect(hook).toContain('pendingDeleteRef');
    expect(hook).toContain('const rawBriefs =');
    expect(hook).toContain('rawBriefs.filter(brief => brief.id !== pendingDelete.id)');
    expect(hook).toContain('rawClientRequests.filter(request => request.id !== pendingDelete.id)');
    expect(hook).toContain('cancelQueries');
    expect(hook).toContain('window.setTimeout');
    expect(hook).toContain('restoreDeletedToCache');
    expect(hook).toContain('originalIndex');
    expect(hook).toContain('undoDelete');
    expect(hook).toContain('Finish or undo the current delete before deleting another item.');
    expect(hook).toContain('Undo is available for a few seconds');

    expect(component).toContain('pendingDelete');
    expect(component).toContain('You can undo this for a few seconds after deleting.');
    expect(component).toContain('onClick={undoDelete}');
    expect(component).toContain('Undo');
  });
});
