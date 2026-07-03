// DEV-ONLY design-system harness — NOT a shipped surface.
// Exempt from nav/registry/route-removal conventions: mounted only behind
// `import.meta.env.DEV` at /__ds-harness (see App.tsx) so it never ships to
// production. Its job is to render the real interactive DS primitives so their
// BEHAVIOR can be exercised by hand (the static styleguide only shows
// appearance — review CP5): overlays (focus trap · Escape · outside-click ·
// portal layering · focus restore), keyboard-nav bars (Segmented/RadioGroup/
// LensSwitcher/Toolbar arrow-nav), and DataTable sort + Enter/Space rows.
// Deliberately NOT marked @ds-rebuilt: it is a scratch host, not a primitive.
import { useState } from 'react';
import { Filter, LayoutGrid, List, Rocket, Activity, Copy, Pencil, Trash2 } from 'lucide-react';
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
  FormInput,
  Button,
} from '../ui';
import { useToast } from '../Toast';

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [seg, setSeg] = useState('28d');
  const [lens, setLens] = useState('table');
  const [radio, setRadio] = useState('draft');
  const [search, setSearch] = useState('');
  const [chipActive, setChipActive] = useState(true);
  const [modalField, setModalField] = useState('');

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
