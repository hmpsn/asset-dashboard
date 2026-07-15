import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { listPseoBlueprintEntries } from '../../server/domains/content/matrix-generation/pseo-bridge.js';
import { addEntry, createBlueprint } from '../../server/page-strategy.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const cleanupWorkspaceIds: string[] = [];

afterEach(() => {
  for (const workspaceId of cleanupWorkspaceIds.splice(0)) deleteWorkspace(workspaceId);
});

describe('pSEO blueprint entry discovery', () => {
  it('returns only collection entries with bounded workspace-scoped pagination', () => {
    const workspace = createWorkspace(`pSEO discovery ${randomUUID()}`);
    cleanupWorkspaceIds.push(workspace.id);
    const blueprint = createBlueprint({
      workspaceId: workspace.id,
      name: 'Local service pages',
      status: 'active',
    });
    addEntry(workspace.id, blueprint.id, {
      name: 'Home page', pageType: 'homepage', isCollection: false,
    });
    const firstEntry = addEntry(workspace.id, blueprint.id, {
      name: 'Location pages', pageType: 'location', isCollection: true,
    });
    const secondEntry = addEntry(workspace.id, blueprint.id, {
      name: 'Service pages', pageType: 'service', isCollection: true, templateId: 'template_1',
    });

    const first = listPseoBlueprintEntries({ workspaceId: workspace.id, limit: 1 });
    const second = listPseoBlueprintEntries({
      workspaceId: workspace.id,
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });

    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map(item => item.entryId)))
      .toEqual(new Set([firstEntry?.id, secondEntry?.id]));
    expect([...first.items, ...second.items]).toEqual(expect.arrayContaining([
      expect.objectContaining({ templateId: null }),
      expect.objectContaining({ templateId: 'template_1' }),
    ]));
    expect(second.nextCursor).toBeNull();
  });

  it('rejects a cursor issued for another workspace', () => {
    const firstWorkspace = createWorkspace(`pSEO cursor source ${randomUUID()}`);
    const secondWorkspace = createWorkspace(`pSEO cursor target ${randomUUID()}`);
    cleanupWorkspaceIds.push(firstWorkspace.id, secondWorkspace.id);
    const blueprint = createBlueprint({ workspaceId: firstWorkspace.id, name: 'Source' });
    addEntry(firstWorkspace.id, blueprint.id, {
      name: 'One', pageType: 'service', isCollection: true,
    });
    addEntry(firstWorkspace.id, blueprint.id, {
      name: 'Two', pageType: 'service', isCollection: true,
    });
    const cursor = listPseoBlueprintEntries({
      workspaceId: firstWorkspace.id, limit: 1,
    }).nextCursor;

    expect(() => listPseoBlueprintEntries({
      workspaceId: secondWorkspace.id,
      cursor: cursor ?? undefined,
    })).toThrow(/cursor is invalid/i);
  });
});
