import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const INBOX_TAB_PATH = 'src/components/client/InboxTab.tsx';
const INBOX_SHELL_PATH = 'src/components/client/inbox/useInboxTabShell.ts';
const INBOX_LAYOUTS_PATH = 'src/components/client/inbox/InboxTabLayouts.tsx';
const INBOX_FILTER_PATH = 'src/components/client/inbox/inbox-filter.ts';

describe('InboxTab phase-2 shell extraction contract', () => {
  it('wires InboxTab root to extracted shell hook, layout wrappers, and filter utilities', () => {
    const source = readFileSync(INBOX_TAB_PATH, 'utf-8'); // readFile-ok - migration guard for inbox decomposition wiring.

    expect(source).toContain("from './inbox/useInboxTabShell'");
    expect(source).toContain("from './inbox/InboxTabLayouts'");
    expect(source).toContain("from './inbox/inbox-filter'");
    expect(source).toContain('const shell = useInboxTabShell({');
    expect(source).toContain('<NewInboxLayout');
    expect(source).toContain('<LegacyInboxLayout');
  });

  it('keeps shell state/effects out of InboxTab root', () => {
    const source = readFileSync(INBOX_TAB_PATH, 'utf-8'); // readFile-ok - migration guard: root should not own local state/effects.

    expect(source).not.toContain('const [filter, setFilter]');
    expect(source).not.toContain('const [mode, setMode]');
    expect(source).not.toContain('const [schemaModalOpen, setSchemaModalOpen]');
    expect(source).not.toContain('useEffect(() => {');
  });

  it('falls back for invalid inbox deep-link filters instead of introducing unsupported values', () => {
    const filtersSource = readFileSync(INBOX_FILTER_PATH, 'utf-8'); // readFile-ok - guard invalid query params resolve through fallback.

    expect(filtersSource).toContain('if (param && LEGACY_FILTER_MAP[param])');
    expect(filtersSource).toContain('return fallback;');
    expect(filtersSource).not.toContain("'schema-review': 'reviews'");
  });

  it('keeps shell/state, layout rendering, and filter contracts in dedicated modules', () => {
    const shellSource = readFileSync(INBOX_SHELL_PATH, 'utf-8'); // readFile-ok - migration guard for shell state ownership.
    const layoutsSource = readFileSync(INBOX_LAYOUTS_PATH, 'utf-8'); // readFile-ok - migration guard for branch-specific layout wrappers.
    const filtersSource = readFileSync(INBOX_FILTER_PATH, 'utf-8'); // readFile-ok - migration guard for deep-link filter resolution.

    expect(shellSource).toContain('export function useInboxTabShell');
    expect(shellSource).toContain("const [mode, setMode] = useState<InboxMode>('active')");
    expect(shellSource).toContain('const [schemaModalOpen, setSchemaModalOpen]');
    expect(shellSource).toContain('setFilter(resolveInboxFilter(');

    expect(layoutsSource).toContain('export function NewInboxLayout');
    expect(layoutsSource).toContain('export function LegacyInboxLayout');
    expect(layoutsSource).toContain('function Chip(');

    expect(filtersSource).toContain('export const INBOX_FILTER_VALUES');
    expect(filtersSource).toContain('export const LEGACY_FILTER_MAP');
    expect(filtersSource).toContain('export function resolveInboxFilter');
  });
});
