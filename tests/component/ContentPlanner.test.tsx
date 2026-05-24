// tests/component/ContentPlanner.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ContentPlanner } from '../../src/components/ContentPlanner';

// ── Matrix sub-component stubs ────────────────────────────────────────────────
vi.mock('../../src/components/matrix', () => ({
  TemplateEditor: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="template-editor">
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
  MatrixBuilder: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="matrix-builder">
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
  MatrixGrid: () => <div data-testid="matrix-grid" />,
}));

// ── API mocks ────────────────────────────────────────────────────────────────
vi.mock('../../src/api/content', () => ({
  contentTemplates: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  contentMatrices: {
    list: vi.fn(),
    create: vi.fn(),
    updateCell: vi.fn(),
    sendSamples: vi.fn(),
    exportMatricesCsv: vi.fn(() => '/export/csv'),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderContentPlanner(workspaceId = 'ws1') {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={['/ws/ws1']}>
        <ContentPlanner workspaceId={workspaceId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Mock data ─────────────────────────────────────────────────────────────────
const mockTemplate = {
  id: 'tpl-1',
  workspaceId: 'ws1',
  name: 'Blog Post Template',
  description: 'A reusable blog post template',
  pageType: 'blog' as const,
  variables: [{ name: 'topic', label: 'Topic', description: 'Main topic' }],
  sections: [],
  urlPattern: '/blog/[topic]',
  keywordPattern: '[topic] guide',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockMatrix = {
  id: 'mat-1',
  workspaceId: 'ws1',
  name: 'City Pages Matrix',
  templateId: 'tpl-1',
  dimensions: [{ variableName: 'city', label: 'City', values: ['Austin', 'Dallas'] }],
  urlPattern: '/services/[city]',
  keywordPattern: '[city] seo',
  cells: [
    { id: 'c1', url: '/services/austin', keyword: 'austin seo', status: 'planned' as const, variables: { city: 'Austin' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'c2', url: '/services/dallas', keyword: 'dallas seo', status: 'published' as const, variables: { city: 'Dallas' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  ],
  stats: { total: 2, planned: 1, briefGenerated: 0, drafted: 0, reviewed: 0, published: 1 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('ContentPlanner', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([]);
  });

  it('renders without crash', () => {
    renderContentPlanner();
    // Title is shown in either empty or data states
    expect(document.body).toBeTruthy();
  });

  it('shows loading spinner while data is being fetched', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockImplementation(
      () => new Promise(() => {}), // never resolves — stays loading
    );
    renderContentPlanner();
    expect(screen.getByText('Loading content planner…')).toBeInTheDocument();
  });

  it('shows empty state when no templates or matrices exist', async () => {
    renderContentPlanner();
    // Wait for loading to settle
    expect(await screen.findByText('No templates or matrices yet')).toBeInTheDocument();
  });

  it('shows empty state description text', async () => {
    renderContentPlanner();
    expect(await screen.findByText(/Start by creating a content template/i)).toBeInTheDocument();
  });

  it('shows "Create First Template" CTA in empty state', async () => {
    renderContentPlanner();
    expect(await screen.findByRole('button', { name: /create first template/i })).toBeInTheDocument();
  });

  it('shows Content Planner header when data is present', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([]);
    renderContentPlanner();
    expect(await screen.findByText('Content Planner')).toBeInTheDocument();
  });

  it('shows template list items when templates are loaded', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([]);
    renderContentPlanner();
    expect(await screen.findByText('Blog Post Template')).toBeInTheDocument();
  });

  it('shows template page type badge', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([]);
    renderContentPlanner();
    // Badge should show the page type
    const badges = await screen.findAllByText('blog');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('shows matrix list items when matrices are loaded', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([mockMatrix]);
    renderContentPlanner();
    expect(await screen.findByText('City Pages Matrix')).toBeInTheDocument();
  });

  it('shows matrix cell count in the list', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([mockMatrix]);
    renderContentPlanner();
    expect(await screen.findByText('2 pages')).toBeInTheDocument();
  });

  it('shows "New Template" button when templates exist', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([]);
    renderContentPlanner();
    expect(await screen.findByRole('button', { name: /new template/i })).toBeInTheDocument();
  });

  it('shows "Build Matrix" button when templates exist', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([]);
    renderContentPlanner();
    expect(await screen.findByRole('button', { name: /build matrix/i })).toBeInTheDocument();
  });

  it('navigates to template editor when "Create First Template" is clicked', async () => {
    renderContentPlanner();
    const cta = await screen.findByRole('button', { name: /create first template/i });
    fireEvent.click(cta);
    expect(screen.getByTestId('template-editor')).toBeInTheDocument();
  });

  it('navigates to template editor when "New Template" button is clicked', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([]);
    renderContentPlanner();
    const btn = await screen.findByRole('button', { name: /new template/i });
    fireEvent.click(btn);
    expect(screen.getByTestId('template-editor')).toBeInTheDocument();
  });

  it('returns to list view when template editor cancel is clicked', async () => {
    renderContentPlanner();
    const cta = await screen.findByRole('button', { name: /create first template/i });
    fireEvent.click(cta);
    expect(screen.getByTestId('template-editor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByTestId('template-editor')).not.toBeInTheDocument();
  });

  it('navigates to matrix builder when "Build Matrix" is clicked', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([]);
    renderContentPlanner();
    const btn = await screen.findByRole('button', { name: /build matrix/i });
    fireEvent.click(btn);
    expect(screen.getByTestId('matrix-builder')).toBeInTheDocument();
  });

  it('shows published/total summary in the matrices section', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([mockMatrix]);
    renderContentPlanner();
    // 1 of 2 published
    expect(await screen.findByText('1/2 published')).toBeInTheDocument();
  });

  it('shows error state when both queries fail', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockRejectedValue(new Error('Network error'));
    vi.mocked(content.contentMatrices.list).mockRejectedValue(new Error('Network error'));
    renderContentPlanner();
    expect(await screen.findByText('Failed to load planner')).toBeInTheDocument();
  });

  it('shows a Retry button in the error state', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockRejectedValue(new Error('Network error'));
    vi.mocked(content.contentMatrices.list).mockRejectedValue(new Error('Network error'));
    renderContentPlanner();
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
