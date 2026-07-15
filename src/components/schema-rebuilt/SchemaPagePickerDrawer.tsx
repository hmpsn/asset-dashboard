// @ds-rebuilt
import { Sparkles } from 'lucide-react';
import type { SchemaPageOption } from '../schema/schemaSuggesterTypes';
import { Button, ClickableRow, Drawer, Icon, SearchField, Toolbar, ToolbarSpacer } from '../ui';

interface SchemaPagePickerDrawerProps {
  open: boolean;
  pages: SchemaPageOption[];
  filteredPages: SchemaPageOption[];
  pageSearch: string;
  generatingSingle: string | null;
  existingPageIds: Set<string>;
  onSearchChange: (value: string) => void;
  onSelectPage: (pageId: string) => void;
  onClose: () => void;
}

export function SchemaPagePickerDrawer({
  open,
  pages,
  filteredPages,
  pageSearch,
  generatingSingle,
  existingPageIds,
  onSearchChange,
  onSelectPage,
  onClose,
}: SchemaPagePickerDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add page"
      eyebrow="Schema generator"
      subtitle={`${pages.length} pages available from the connected Webflow site.`}
      width={520}
      footer={(
        <Toolbar label="Page picker actions" className="w-full border-none bg-transparent p-0">
          <span className="t-caption-sm text-[var(--brand-text-muted)]">{filteredPages.length} matching pages</span>
          <ToolbarSpacer />
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
        </Toolbar>
      )}
    >
      <div className="flex flex-col gap-3">
        <SearchField
          value={pageSearch}
          onChange={onSearchChange}
          placeholder="Search pages..."
          autoFocus
        />
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)]">
          {filteredPages.length === 0 ? (
            <div className="px-4 py-8 text-center t-caption text-[var(--brand-text-muted)]">No pages match that search.</div>
          ) : (
            filteredPages.map((page) => {
              const alreadyGenerated = existingPageIds.has(page.id);
              return (
                <ClickableRow
                  key={page.id}
                  disabled={generatingSingle === page.id}
                  onClick={() => onSelectPage(page.id)}
                  className="border-b border-[var(--brand-border)] px-4 py-3 duration-[var(--dur-fast)] last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)]">
                      <Icon as={Sparkles} size="sm" style={{ color: 'var(--teal)' }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate t-ui text-[var(--brand-text-bright)]">{page.title || 'Untitled page'}</span>
                      <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">/{page.slug || ''}</span>
                    </span>
                    {alreadyGenerated && <span className="t-caption-sm text-[var(--brand-text-muted)]">Generated</span>}
                  </div>
                </ClickableRow>
              );
            })
          )}
        </div>
      </div>
    </Drawer>
  );
}
