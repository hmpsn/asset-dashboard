import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const CMS_EDITOR_PATH = 'src/components/CmsEditor.tsx';
const CMS_EDITOR_COLLECTIONS_PATH = 'src/components/cms-editor/CmsEditorCollections.tsx';

describe('CmsEditor phase-6 collections render extraction contract', () => {
  it('wires CmsEditor root to extracted collections renderer', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: CmsEditor root should consume extracted collections renderer in phase 6.

    expect(cmsEditorSource).toContain("from './cms-editor/CmsEditorCollections'");
    expect(cmsEditorSource).toContain('<CmsEditorCollections');
    expect(cmsEditorSource).toContain('collections={displayCollections}');
    expect(cmsEditorSource).toContain('toggleSelectAllInCollection={toggleSelectAllInCollection}');
    expect(cmsEditorSource).toContain('saveItem={saveItem}');
    expect(cmsEditorSource).toContain('aiRewriteBoth={aiRewriteBoth}');
  });

  it('keeps collections/item render monolith out of CmsEditor root shell', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: large collection/item render logic should not drift back into CmsEditor root after phase 6.

    expect(cmsEditorSource).not.toContain('const filteredItems = filterAndRankCollectionItems(coll, search)');
    expect(cmsEditorSource).not.toContain('const allInCollSelected = filteredItemIds.length > 0');
    expect(cmsEditorSource).not.toContain("AI Generate Both");
    expect(cmsEditorSource).not.toContain('Latest: {latest.batchName}');
    expect(cmsEditorSource).not.toContain('Google Search');
  });

  it('keeps collection/item render logic in extracted component', () => {
    const collectionsSource = readFileSync(CMS_EDITOR_COLLECTIONS_PATH, 'utf-8'); // readFile-ok - migration guard: collection/item render ownership belongs in extracted component after phase 6.

    expect(collectionsSource).toContain('export function CmsEditorCollections');
    expect(collectionsSource).toContain('filterAndRankCollectionItems(coll, search)');
    expect(collectionsSource).toContain('toggleSelectAllInCollection(filteredItemIds)');
    expect(collectionsSource).toContain('AI Generate Both');
    expect(collectionsSource).toContain('Latest: {latest.batchName}');
    expect(collectionsSource).toContain('Google Search');
  });
});
