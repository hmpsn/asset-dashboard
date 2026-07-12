// DEV-ONLY design-system harness — NOT a shipped surface.
// Exempt from nav/registry/route-removal conventions: mounted only behind
// `import.meta.env.DEV` at /__ds-harness (see App.tsx) so it never ships to
// production. Its job is to render the real interactive DS primitives so their
// BEHAVIOR can be exercised by hand (the static styleguide only shows
// appearance — review CP5): overlays (focus trap · Escape · outside-click ·
// portal layering · focus restore), keyboard-nav bars (Segmented/RadioGroup/
// LensSwitcher/Toolbar arrow-nav), and DataTable sort + Enter/Space rows.
// Deliberately NOT marked @ds-rebuilt: it is a scratch host, not a primitive.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Filter, LayoutGrid, List, Rocket, Activity, Copy, Pencil, Trash2 } from 'lucide-react';
import { FEATURE_FLAGS } from '../../../shared/types/feature-flags';
import { queryKeys } from '../../lib/queryKeys';
import {
  Avatar,
  IntentTag,
  DataTable,
  type DataColumn,
  MetricTile,
  Sparkline,
  Meter,
  KeyValueRow,
  DefinitionList,
  BoardColumn,
  BoardCard,
  Segmented,
  LensSwitcher,
  FilterChip,
  SearchField,
  RadioGroup,
  AppShell,
  PageContainer,
  Toolbar,
  ToolbarSpacer,
  GroupBlock,
  Drawer,
  Modal,
  Popover,
  Tooltip,
  Menu,
  ConfirmDialog,
  FormField,
  FormInput,
  FormSelect,
  FormTextarea,
  Toggle,
  Checkbox,
  TabBar,
  Disclosure,
  ClickableRow,
  DateRangeSelector,
  Button,
} from '../ui';
import { useToast } from '../Toast';
import { RebuiltAppChrome } from '../layout/RebuiltAppChrome';
import type { Workspace } from '../WorkspaceSelector';

const TABLE_COLUMNS: DataColumn[] = [
  { key: 'keyword', label: 'Keyword', width: '1.6fr', sortable: true },
  { key: 'volume', label: 'Volume', width: '90px', align: 'right', sortable: true },
  { key: 'position', label: 'Pos', width: '70px', align: 'right', sortable: true },
];

const TABLE_ROWS = [
  { keyword: 'seo audit tool', volume: 5400, position: 4 },
  { keyword: 'local seo services', volume: 2900, position: 11 },
  { keyword: 'content strategy', volume: 8100, position: 2 },
  { keyword: 'schema markup guide', volume: 1300, position: 7 },
];

const SHELL_WORKSPACES: Workspace[] = [
  { id: 'demo-linked', name: 'Acme Dental', webflowSiteId: 'site-demo', webflowSiteName: 'acme.example', folder: 'acme', createdAt: '2026-07-05' },
  { id: 'demo-nosite', name: 'No-site Workspace', folder: 'nosite', createdAt: '2026-07-05' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 className="t-h2" style={{ color: 'var(--brand-text-bright)' }}>{title}</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>{children}</div>
    </section>
  );
}

export default function DsHarness() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [seg, setSeg] = useState('28d');
  const [lens, setLens] = useState('table');
  const [radio, setRadio] = useState('draft');
  const [search, setSearch] = useState('');
  const [chipActive, setChipActive] = useState(true);
  const [modalField, setModalField] = useState('');
  const [toggleOn, setToggleOn] = useState(true);
  const [checkOn, setCheckOn] = useState(false);
  const [formVal, setFormVal] = useState('');
  const [selectVal, setSelectVal] = useState('growth');
  const [textareaVal, setTextareaVal] = useState('');
  const [tab, setTab] = useState('overview');
  const [days, setDays] = useState(28);
  const [shellTheme, setShellTheme] = useState<'dark' | 'light'>('dark');
  const [shellSelectedId, setShellSelectedId] = useState(SHELL_WORKSPACES[0].id);
  const shellSelected = SHELL_WORKSPACES.find((workspace) => workspace.id === shellSelectedId) ?? SHELL_WORKSPACES[0];

  useEffect(() => {
    queryClient.setQueryData(queryKeys.shared.featureFlags(), FEATURE_FLAGS);
  }, [queryClient]);

  return (
    <PageContainer width="wide" center>
      <h1 className="t-h1" style={{ color: 'var(--brand-text-bright)' }}>DS Harness</h1>
      <p className="t-body" style={{ color: 'var(--brand-text-muted)' }}>
        Dev-only behavior bench — open the overlays, tab in, and keyboard-walk each
        control. Appearance lives in the styleguide; this is where behavior gets poked.
      </p>

      <Section title="Overlays — focus trap · Escape · outside-click · keyboard">
        <Button onClick={() => setDrawerOpen(true)}>Drawer</Button>
        <Button onClick={() => setModalOpen(true)}>Modal</Button>
        <Button variant="secondary" onClick={() => setConfirmOpen(true)}>ConfirmDialog</Button>
        <Popover trigger={<Button variant="secondary">Popover ▾</Button>}>
          <Popover.Item onClick={() => toast('Item one', 'info')}>Item one</Popover.Item>
          <Popover.Item onClick={() => toast('Item two', 'info')}>Item two</Popover.Item>
          <Popover.Separator />
          <Popover.Item onClick={() => toast('Item three', 'info')}>Item three</Popover.Item>
        </Popover>
        <Menu
          trigger={<Button variant="secondary">Menu ▾</Button>}
          items={[
            { label: 'Copy', icon: Copy, onSelect: () => toast('Copied', 'success') },
            { label: 'Edit', icon: Pencil, onSelect: () => toast('Editing', 'info') },
            { label: 'Delete', icon: Trash2, onSelect: () => toast('Deleted', 'error') },
          ]}
        />
        <Tooltip content="Shows on hover + focus; hides on Escape/blur">
          <Button variant="ghost">Hover / focus me</Button>
        </Tooltip>
      </Section>

      <Section title="Feedback">
        <Avatar initials="JH" tone="teal" />
        <Avatar icon={Rocket} tone="zinc" />
        <IntentTag intent="commercial" />
        <IntentTag intent="informational" abbreviate />
        <IntentTag intent="transactional" />
        <IntentTag intent="local" />
        <Button variant="secondary" onClick={() => toast('Saved changes', 'success')}>Fire toast</Button>
      </Section>

      <Section title="Forms (arrow-key walk these)">
        <Segmented
          options={[{ value: '7d', label: '7d' }, { value: '28d', label: '28d' }, { value: '90d', label: '90d' }]}
          value={seg}
          onChange={setSeg}
        />
        <LensSwitcher
          options={[
            { value: 'table', label: 'Table', icon: List, count: 42 },
            { value: 'board', label: 'Board', icon: LayoutGrid, count: 8 },
          ]}
          value={lens}
          onChange={setLens}
        />
        <FilterChip label="Commercial" icon={Filter} count={12} active={chipActive} onClick={() => setChipActive(v => !v)} onRemove={() => toast('Removed filter', 'info')} />
        <SearchField value={search} onChange={setSearch} placeholder="Search keywords…" kbd="⌘K" />
        <RadioGroup
          options={[{ value: 'draft', label: 'Draft' }, { value: 'review', label: 'In review' }, { value: 'live', label: 'Live' }]}
          value={radio}
          onChange={setRadio}
        />
      </Section>

      <Section title="Form controls — focus · validation · keyboard">
        <div style={{ width: 240 }}>
          <FormField label="Email" hint="We never share it">
            <FormInput value={formVal} onChange={setFormVal} placeholder="you@example.com" />
          </FormField>
        </div>
        <div style={{ width: 240 }}>
          <FormField label="Plan">
            <FormSelect
              options={[{ value: 'free', label: 'Free' }, { value: 'growth', label: 'Growth' }, { value: 'premium', label: 'Premium' }]}
              value={selectVal}
              onChange={setSelectVal}
            />
          </FormField>
        </div>
        <div style={{ width: 240 }}>
          <FormField label="Notes" error={textareaVal.length > 40 ? 'Keep it under 40 characters' : undefined}>
            <FormTextarea value={textareaVal} onChange={setTextareaVal} placeholder="Type to trigger the error state…" />
          </FormField>
        </div>
        <Toggle checked={toggleOn} onChange={setToggleOn} label="Auto-send" />
        <Checkbox checked={checkOn} onChange={setCheckOn} label="I agree to the terms" />
      </Section>

      <Section title="Navigation & disclosure — keyboard tabs · expand/collapse · clickable rows">
        <div style={{ width: '100%', maxWidth: 420 }}>
          {/* tab-deeplink-ok — dev harness demo, not a routed surface; local state is intentional */}
          <TabBar
            tabs={[{ id: 'overview', label: 'Overview' }, { id: 'details', label: 'Details' }, { id: 'activity', label: 'Activity' }]}
            active={tab}
            onChange={setTab}
            ariaLabel="Demo tabs"
          />
        </div>
        <div style={{ width: '100%', maxWidth: 420 }}>
          <Disclosure summary="Advanced options">
            <p className="t-body" style={{ color: 'var(--brand-text)' }}>
              Hidden until expanded — native &lt;details&gt;, so Space/Enter toggles it.
            </p>
          </Disclosure>
        </div>
        <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ClickableRow onClick={() => toast('Row one', 'info')}>
            <span className="t-ui" style={{ color: 'var(--brand-text-bright)' }}>Clickable row — Enter/Space activates</span>
          </ClickableRow>
          <ClickableRow active onClick={() => toast('Row two', 'info')}>
            <span className="t-ui" style={{ color: 'var(--brand-text-bright)' }}>Active clickable row</span>
          </ClickableRow>
        </div>
        <DateRangeSelector
          options={[{ label: '7d', value: 7 }, { label: '28d', value: 28 }, { label: '90d', value: 90 }]}
          selected={days}
          onChange={setDays}
        />
      </Section>

      <Section title="Data display">
        <div style={{ display: 'flex', gap: 12 }}>
          <MetricTile label="Clicks" value="12.4k" delta={8.2} icon={Activity} accent="var(--blue)" />
          <MetricTile label="Avg position" value="6.1" delta={-2} invertDelta deltaLabel="vs last mo" />
        </div>
        <Sparkline data={[3, 5, 4, 8, 6, 9, 7, 11]} area label="Clicks trend" />
        <div style={{ width: 220 }}>
          <Meter value={68} label="Health" showValue />
          <Meter value={92} gradient />
        </div>
        <div style={{ width: 260 }}>
          <DefinitionList
            items={[
              { label: 'Domain', value: 'example.com', mono: true },
              { label: 'Keywords', value: 128 },
              { label: 'Coverage', value: '73%' },
            ]}
          />
        </div>
        <div style={{ width: 220 }}>
          <BoardColumn title="In progress" count={2} accent="var(--amber)">
            <BoardCard title="Rewrite homepage" meta="Due Fri" onClick={() => toast('Card clicked', 'info')} />
            <BoardCard title="Schema audit" meta="2 pages" />
          </BoardColumn>
        </div>
      </Section>

      <Section title="Data table (Tab to a row, Enter/Space to activate; sort headers)">
        <div style={{ width: '100%', maxWidth: 520 }}>
          <DataTable columns={TABLE_COLUMNS} rows={TABLE_ROWS} onRowClick={(r) => toast(`Row: ${(r as { keyword: string }).keyword}`, 'info')} />
        </div>
      </Section>

      <Section title="Layout">
        <div style={{ width: '100%', maxWidth: 640 }}>
          <Toolbar label="Table controls">
            <SearchField value="" onChange={() => {}} placeholder="Filter…" />
            <FilterChip label="Active" active />
            <FilterChip label="Archived" />
            <ToolbarSpacer />
            <Button>New</Button>
          </Toolbar>
        </div>
        <div style={{ width: '100%', maxWidth: 640 }}>
          <GroupBlock
            title="Commercial cluster"
            meta="12 keywords"
            icon={LayoutGrid}
            stats={[{ label: 'Volume', value: '18.2k' }, { label: 'Avg pos', value: '5.4' }]}
            collapsible
          >
            <KeyValueRow label="Top page" value="/services" divider={false} />
            <KeyValueRow label="Intent" value="Commercial" />
          </GroupBlock>
        </div>
        <div
          style={{
            width: 420,
            height: 220,
            border: '1px solid var(--brand-border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            resize: 'horizontal',
          }}
        >
          <AppShell
            sidebar={<div style={{ padding: 12, color: 'var(--brand-text-muted)' }} className="t-caption">Sidebar</div>}
            topbar={<span className="t-ui" style={{ color: 'var(--brand-text-bright)' }}>Topbar</span>}
          >
            <div style={{ padding: 16 }} className="t-body">AppShell content (miniature)</div>
          </AppShell>
        </div>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Toolbar label="Rebuilt shell demo controls">
            <Button variant="secondary" onClick={() => setShellTheme((value) => value === 'dark' ? 'light' : 'dark')}>
              {shellTheme === 'dark' ? 'Light' : 'Dark'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShellSelectedId((value) => value === SHELL_WORKSPACES[0].id ? SHELL_WORKSPACES[1].id : SHELL_WORKSPACES[0].id)}
            >
              {shellSelected.webflowSiteId ? 'No site' : 'Linked site'}
            </Button>
          </Toolbar>
          <div
            className={shellTheme === 'light' ? 'dashboard-light' : undefined}
            style={{
              width: '100%',
              maxWidth: 960,
              height: 560,
              border: '1px solid var(--brand-border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              background: 'var(--surface-1)',
            }}
          >
            <RebuiltAppChrome
              workspaces={SHELL_WORKSPACES}
              selected={shellSelected}
              tab="seo-keywords"
              theme={shellTheme}
              pendingContentRequests={3}
              connectionHealth={{
                connected: true,
                hasOpenAIKey: true,
                hasWebflowToken: true,
                workspaceCount: SHELL_WORKSPACES.length,
              }}
              onCreate={(name) => toast(`Create ${name}`, 'info')}
              onDelete={(id) => toast(`Delete ${id}`, 'error')}
              onLinkSite={(workspaceId) => toast(`Link ${workspaceId}`, 'info')}
              onUnlinkSite={(workspaceId) => toast(`Unlink ${workspaceId}`, 'info')}
              toggleTheme={() => setShellTheme((value) => value === 'dark' ? 'light' : 'dark')}
            >
              <GroupBlock title="Keyword pilot body" meta="Harness specimen" collapsible>
                <p className="t-body" style={{ color: 'var(--brand-text)' }}>
                  The rebuilt shell is mounted here as a real composition: collapse groups,
                  arrow-key through nav items, and toggle the selected workspace to verify
                  needs-site gating.
                </p>
              </GroupBlock>
            </RebuiltAppChrome>
          </div>
        </div>
      </Section>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        eyebrow="Keyword"
        title="seo audit tool"
        subtitle="Commercial · volume 5,400"
        footer={<Button onClick={() => setDrawerOpen(false)}>Done</Button>}
      >
        <p className="t-body" style={{ color: 'var(--brand-text)' }}>
          Drawer body — Tab cycles inside, focus is trapped, Escape closes, and focus
          restores to the trigger button.
        </p>
      </Drawer>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <Modal.Header title="Modal title" onClose={() => setModalOpen(false)} />
        <Modal.Body>
          <p className="t-body">
            Centered dialog — focus trapped, Escape closes, backdrop-click closes, focus
            restores. Tab cycles the field and buttons.
          </p>
          <div style={{ marginTop: 12 }}>
            <FormInput value={modalField} onChange={setModalField} placeholder="A focusable field" />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={() => { setModalOpen(false); toast('Confirmed', 'success'); }}>Confirm</Button>
        </Modal.Footer>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this item?"
        message="This can't be undone. Escape or Cancel backs out; Enter or Confirm proceeds."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => { setConfirmOpen(false); toast('Deleted', 'error'); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </PageContainer>
  );
}
