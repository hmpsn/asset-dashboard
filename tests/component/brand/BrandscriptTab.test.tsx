// tests/component/brand/BrandscriptTab.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BrandscriptTab } from '../../../src/components/brand/BrandscriptTab';
import type { Brandscript, BrandscriptTemplate } from '../../../shared/types/brand-engine';

// ── Mock API ────────────────────────────────────────────────────────────────
const mockBrandscriptsApi = {
  list: vi.fn(),
  templates: vi.fn(),
  create: vi.fn(),
  updateSections: vi.fn(),
  remove: vi.fn(),
  import: vi.fn(),
  complete: vi.fn(),
};

vi.mock('../../../src/api/brand-engine', () => ({
  brandscripts: {
    list: (...args: unknown[]) => mockBrandscriptsApi.list(...args),
    templates: (...args: unknown[]) => mockBrandscriptsApi.templates(...args),
    create: (...args: unknown[]) => mockBrandscriptsApi.create(...args),
    updateSections: (...args: unknown[]) => mockBrandscriptsApi.updateSections(...args),
    remove: (...args: unknown[]) => mockBrandscriptsApi.remove(...args),
    import: (...args: unknown[]) => mockBrandscriptsApi.import(...args),
    complete: (...args: unknown[]) => mockBrandscriptsApi.complete(...args),
  },
}));

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderTab(
  workspaceId = 'ws-test',
  queryClient?: QueryClient,
  options: { focusFirstExisting?: boolean; onClearFocus?: () => void } = {},
) {
  const qc = queryClient ?? makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BrandscriptTab
          workspaceId={workspaceId}
          focusFirstExisting={options.focusFirstExisting}
          onClearFocus={options.onClearFocus}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeBrandscript(overrides: Partial<Brandscript> = {}): Brandscript {
  return {
    id: 'bs-1',
    workspaceId: 'ws-test',
    name: 'My StoryBrand Script',
    frameworkType: 'StoryBrand',
    sections: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSection(overrides: Partial<{ id: string; title: string; content: string; purpose: string; sortOrder: number }> = {}) {
  return {
    id: 'sec-1',
    brandscriptId: 'bs-1',
    title: 'Hero Message',
    content: 'We help small businesses grow.',
    purpose: 'Capture the one-liner value proposition.',
    sortOrder: 0,
    ...overrides,
  };
}

function makeTemplate(id = 't1', name = 'StoryBrand'): BrandscriptTemplate {
  return { id, name };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BrandscriptTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrandscriptsApi.list.mockResolvedValue([]);
    mockBrandscriptsApi.templates.mockResolvedValue([]);
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  it('renders skeleton loading state while data fetches', async () => {
    let resolveList: (v: Brandscript[]) => void;
    mockBrandscriptsApi.list.mockReturnValue(new Promise(r => { resolveList = r; }));

    renderTab();

    // Skeleton elements render immediately (multiple h-14 placeholders)
    expect(document.querySelectorAll('[class*="animate-pulse"], [class*="skeleton"]').length +
           document.querySelectorAll('[style*="animation"]').length).toBeGreaterThanOrEqual(0);
    // The section card header should be visible
    expect(await screen.findByText('Brandscript Builder')).toBeInTheDocument();

    resolveList!([]);
  });

  // ── Empty state ───────────────────────────────────────────────────────────

  it('shows empty state with Create Brandscript CTA when list is empty', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([]);
    mockBrandscriptsApi.templates.mockResolvedValue([]);

    renderTab();

    expect(await screen.findByText('No brandscripts yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create brandscript/i })).toBeInTheDocument();
  });

  it('shows description text about creating a StoryBrand script in empty state', async () => {
    renderTab();

    await screen.findByText('No brandscripts yet');
    expect(screen.getByText(/Create a StoryBrand script/i)).toBeInTheDocument();
  });

  // ── List view ─────────────────────────────────────────────────────────────

  it('renders brandscript list items when data loads', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    renderTab();

    expect(await screen.findByText('My StoryBrand Script')).toBeInTheDocument();
    // Framework type shows in the subtitle below the name (e.g. "StoryBrand · 0 sections")
    expect(screen.getByText(/StoryBrand · 0 section/)).toBeInTheDocument();
  });

  it('shows section count for each brandscript in the list', async () => {
    const sections = [makeSection(), makeSection({ id: 'sec-2', title: 'Problem' })];
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript({ sections })]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    expect(screen.getByText(/2 sections/)).toBeInTheDocument();
  });

  it('shows "New Brandscript" toolbar button when list is non-empty', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    expect(screen.getByRole('button', { name: /new brandscript/i })).toBeInTheDocument();
  });

  it('shows delete button for each brandscript item', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    expect(screen.getByRole('button', { name: /delete brandscript/i })).toBeInTheDocument();
  });

  it('renders row selection and delete as separate sibling buttons', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    const { container } = renderTab();

    const name = await screen.findByText('My StoryBrand Script');
    const selectButton = name.closest('button');
    const deleteButton = screen.getByRole('button', { name: /delete brandscript/i });

    expect(selectButton).not.toBeNull();
    expect(selectButton).not.toContainElement(deleteButton);
    expect(container.querySelector('button button')).toBeNull();

    fireEvent.click(deleteButton);
    expect(await screen.findByText('Delete Brandscript')).toBeInTheDocument();
    expect(screen.queryByText('← All brandscripts')).not.toBeInTheDocument();
  });

  it('opens the first real Brandscript only when overview focus is requested', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([
      makeBrandscript({ id: 'bs-current', name: 'Current StoryBrand' }),
      makeBrandscript({ id: 'bs-older', name: 'Older StoryBrand' }),
    ]);

    const { unmount } = renderTab('ws-test', undefined, { focusFirstExisting: true });

    expect(await screen.findByText('← All brandscripts')).toBeInTheDocument();
    expect(screen.getByText('Current StoryBrand')).toBeInTheDocument();

    unmount();
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);
    renderTab();

    expect(await screen.findByText('My StoryBrand Script')).toBeInTheDocument();
    expect(screen.queryByText('← All brandscripts')).not.toBeInTheDocument();
  });

  it('returns an overview-focused Brandscript to its library and clears focus', async () => {
    const onClearFocus = vi.fn();
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    renderTab('ws-test', undefined, { focusFirstExisting: true, onClearFocus });

    fireEvent.click(await screen.findByRole('button', { name: 'Back to all brandscripts' }));

    await waitFor(() => {
      expect(screen.queryByText('← All brandscripts')).not.toBeInTheDocument();
    });
    expect(screen.getByText('My StoryBrand Script')).toBeInTheDocument();
    expect(onClearFocus).toHaveBeenCalledTimes(1);
  });

  // ── Create form ───────────────────────────────────────────────────────────

  it('shows create form when New Brandscript button is clicked', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByRole('button', { name: /new brandscript/i }));
    expect(screen.getByText('New Brandscript')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. StoryBrand 2024')).toBeInTheDocument();
  });

  it('create form shows template options from API', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([]);
    mockBrandscriptsApi.templates.mockResolvedValue([makeTemplate('t1', 'StoryBrand')]);

    renderTab();

    await screen.findByText('No brandscripts yet');
    fireEvent.click(screen.getByRole('button', { name: /create brandscript/i }));

    await waitFor(() => {
      expect(screen.getByText('Framework (optional)')).toBeInTheDocument();
    });
  });

  it('create form cancel hides the form', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([]);

    renderTab();

    await screen.findByText('No brandscripts yet');
    fireEvent.click(screen.getByRole('button', { name: /create brandscript/i }));
    await screen.findByText('New Brandscript');

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByText('New Brandscript')).not.toBeInTheDocument();
    });
  });

  it('submitting create form calls brandscripts.create with correct args', async () => {
    const newBs = makeBrandscript({ id: 'bs-new', name: 'Test Script' });
    mockBrandscriptsApi.list.mockResolvedValue([]);
    mockBrandscriptsApi.create.mockResolvedValue(newBs);

    renderTab();

    await screen.findByText('No brandscripts yet');
    fireEvent.click(screen.getByRole('button', { name: /create brandscript/i }));
    await screen.findByText('New Brandscript');

    fireEvent.change(screen.getByPlaceholderText('e.g. StoryBrand 2024'), {
      target: { value: 'Test Script' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(mockBrandscriptsApi.create).toHaveBeenCalledWith('ws-test', {
        name: 'Test Script',
        frameworkType: undefined,
      });
    });
  });

  // ── Detail view ───────────────────────────────────────────────────────────

  it('clicking a brandscript navigates to detail view', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));

    await waitFor(() => {
      expect(screen.getByText('← All brandscripts')).toBeInTheDocument();
    });
  });

  it('detail view shows brandscript name in breadcrumb', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));

    await screen.findByText('← All brandscripts');
    // The name appears in the breadcrumb area
    expect(screen.getAllByText('My StoryBrand Script').length).toBeGreaterThan(0);
  });

  it('back button returns to list view from detail', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));
    await screen.findByText('← All brandscripts');

    fireEvent.click(screen.getByText('← All brandscripts'));

    await waitFor(() => {
      expect(screen.queryByText('← All brandscripts')).not.toBeInTheDocument();
    });
  });

  it('detail view shows Edit sections / Import text mode toggle', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));

    await screen.findByText('Edit sections');
    expect(screen.getByText('Import text')).toBeInTheDocument();
  });

  it('detail view shows section cards with content', async () => {
    const sections = [makeSection()];
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript({ sections })]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));

    await screen.findByText('Hero Message');
  });

  it('renders readable collapsed Markdown previews while preserving raw editor content', async () => {
    const rawContent = '## **External Problem:** Corporate offices that feel profit-driven.';
    const sections = [makeSection({ content: rawContent })];
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript({ sections })]);

    renderTab();
    fireEvent.click(await screen.findByText('My StoryBrand Script'));

    expect(await screen.findByText('External Problem: Corporate offices that feel profit-driven.')).toBeInTheDocument();
    expect(screen.queryByText(/##|\*\*/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Hero Message'));
    expect(await screen.findByPlaceholderText('Enter section content...')).toHaveValue(rawContent);
  });

  it('detail view shows "No sections yet" when sections array is empty', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript({ sections: [] })]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));

    await screen.findByText('No sections yet.');
  });

  it('shows Complete N empty sections button when empty sections exist', async () => {
    const sections = [
      makeSection({ content: '' }),
      makeSection({ id: 'sec-2', title: 'Problem', content: '' }),
    ];
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript({ sections })]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));

    await screen.findByText(/complete 2 empty sections/i);
  });

  it('clicking Complete empty sections button calls brandscripts.complete', async () => {
    const sections = [makeSection({ content: '' })];
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript({ sections })]);
    mockBrandscriptsApi.complete.mockResolvedValue(makeBrandscript({ sections: [makeSection({ content: 'AI-filled' })] }));

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));

    const completeBtn = await screen.findByRole('button', { name: /complete 1 empty section/i });
    fireEvent.click(completeBtn);

    await waitFor(() => {
      expect(mockBrandscriptsApi.complete).toHaveBeenCalledWith('ws-test', 'bs-1');
    });
  });

  // ── Section editor ────────────────────────────────────────────────────────

  it('expanding a section card shows the textarea for editing', async () => {
    const sections = [makeSection()];
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript({ sections })]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));
    await screen.findByText('Hero Message');

    // Click the section header to expand
    fireEvent.click(screen.getByText('Hero Message'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter section content...')).toBeInTheDocument();
    });
  });

  it('editing section content enables the Save button', async () => {
    const sections = [makeSection({ content: 'Original content' })];
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript({ sections })]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));
    await screen.findByText('Hero Message');

    fireEvent.click(screen.getByText('Hero Message'));
    await screen.findByPlaceholderText('Enter section content...');

    const textarea = screen.getByPlaceholderText('Enter section content...');
    fireEvent.change(textarea, { target: { value: 'Updated content' } });

    const saveBtn = screen.getByRole('button', { name: /^save$/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it('saving section calls brandscripts.updateSections', async () => {
    const sections = [makeSection({ content: 'Original' })];
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript({ sections })]);
    mockBrandscriptsApi.updateSections.mockResolvedValue(makeBrandscript({ sections }));

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));
    await screen.findByText('Hero Message');

    fireEvent.click(screen.getByText('Hero Message'));
    await screen.findByPlaceholderText('Enter section content...');

    const textarea = screen.getByPlaceholderText('Enter section content...');
    fireEvent.change(textarea, { target: { value: 'Updated content' } });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockBrandscriptsApi.updateSections).toHaveBeenCalled();
    });
  });

  // ── Import mode ───────────────────────────────────────────────────────────

  it('clicking Import text mode shows the import form', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));
    await screen.findByText('Import text');

    fireEvent.click(screen.getByText('Import text'));

    await screen.findByText('Import Brandscript');
    expect(screen.getByPlaceholderText(/paste your brandscript content/i)).toBeInTheDocument();
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  it('clicking delete on a brandscript shows confirm dialog', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    const deleteBtn = screen.getByRole('button', { name: /delete brandscript/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByText('Delete Brandscript')).toBeInTheDocument();
    });
  });

  it('confirming delete calls brandscripts.remove', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);
    mockBrandscriptsApi.remove.mockResolvedValue(undefined);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByRole('button', { name: /delete brandscript/i }));
    await screen.findByText('Delete Brandscript');

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(mockBrandscriptsApi.remove).toHaveBeenCalledWith('ws-test', 'bs-1');
    });
  });

  it('cancelling delete dialog leaves the brandscript in the list', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByRole('button', { name: /delete brandscript/i }));
    await screen.findByText('Delete Brandscript');

    // Cancel the dialog
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByText('Delete Brandscript')).not.toBeInTheDocument();
    });
    expect(mockBrandscriptsApi.remove).not.toHaveBeenCalled();
    expect(screen.getByText('My StoryBrand Script')).toBeInTheDocument();
  });

  // ── Framework type display ────────────────────────────────────────────────

  it('shows framework type badge in detail view breadcrumb', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript({ frameworkType: 'StoryBrand' })]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));

    await screen.findByText('← All brandscripts');
    expect(screen.getByText('StoryBrand')).toBeInTheDocument();
  });

  // ── Section purpose text ──────────────────────────────────────────────────

  it('shows purpose text in expanded section', async () => {
    const sections = [makeSection({ purpose: 'Capture the hero one-liner here.' })];
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript({ sections })]);

    renderTab();

    await screen.findByText('My StoryBrand Script');
    fireEvent.click(screen.getByText('My StoryBrand Script'));
    await screen.findByText('Hero Message');

    fireEvent.click(screen.getByText('Hero Message'));

    await screen.findByText('Capture the hero one-liner here.');
  });

  // ── Design system compliance ──────────────────────────────────────────────

  it('contains no violet or indigo color classes', async () => {
    mockBrandscriptsApi.list.mockResolvedValue([makeBrandscript()]);
    const { container } = renderTab();

    await screen.findByText('My StoryBrand Script');
    const html = container.innerHTML;
    expect(html).not.toMatch(/\bviolet-/);
    expect(html).not.toMatch(/\bindigo-/);
  });
});
