// tests/component/ContentPlanner.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ContentPlanner } from '../../src/components/ContentPlanner';
import { queryKeys } from '../../src/lib/queryKeys';
import { MATRIX_GENERATION_CONTRACT_VERSION } from '../../shared/types/matrix-generation';

// ── Matrix sub-component stubs ────────────────────────────────────────────────
vi.mock('../../src/components/matrix', async () => {
  const actual = await vi.importActual<typeof import('../../src/components/matrix')>(
    '../../src/components/matrix',
  );
  const ActualTemplateEditor = actual.TemplateEditor;

  return {
    ...actual,
    TemplateEditor: (props: React.ComponentProps<typeof ActualTemplateEditor>) => (
      <div data-testid="template-editor">
        <ActualTemplateEditor {...props} />
      </div>
    ),
    MatrixBuilder: ({ onCancel }: { onCancel: () => void }) => (
      <div data-testid="matrix-builder">
        <button onClick={onCancel}>Cancel</button>
      </div>
    ),
    MatrixGrid: ({ onCellUpdate, onBulkAction, generationEnabled }: {
      onCellUpdate: (cellId: string, updates: Record<string, unknown>) => void;
      onBulkAction: (action: 'generate_briefs', cellIds: string[]) => void;
      generationEnabled?: boolean;
    }) => (
      <div data-testid="matrix-grid">
        <button onClick={() => onCellUpdate('c1', { customKeyword: 'austin seo agency' })}>
          Update first cell
        </button>
        {generationEnabled && (
          <button onClick={() => onBulkAction('generate_briefs', ['c1'])}>
            Generate Pages
          </button>
        )}
      </div>
    ),
  };
});

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
    previewGeneration: vi.fn(),
    startGeneration: vi.fn(),
    getGeneration: vi.fn(),
    retryGeneration: vi.fn(),
    approveGenerationItem: vi.fn(),
    exportMatricesCsv: vi.fn(() => '/export/csv'),
  },
}));

vi.mock('../../src/api/platform', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/platform')>('../../src/api/platform');
  return {
    ...actual,
    workspaceFeatureFlags: {
      ...actual.workspaceFeatureFlags,
      list: vi.fn(),
    },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderContentPlanner(
  workspaceId = 'ws1',
  initialEntry = '/ws/ws1',
) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ContentPlanner workspaceId={workspaceId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Mock data ─────────────────────────────────────────────────────────────────
const mockTemplate = {
  id: 'tpl-1',
  workspaceId: 'ws1',
  revision: 3,
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
  revision: 5,
  name: 'City Pages Matrix',
  templateId: 'tpl-1',
  dimensions: [{ variableName: 'city', label: 'City', values: ['Austin', 'Dallas'] }],
  urlPattern: '/services/[city]',
  keywordPattern: '[city] seo',
  cells: [
    { id: 'c1', revision: 7, plannedUrl: '/services/austin', targetKeyword: 'austin seo', status: 'planned' as const, variableValues: { city: 'Austin' } },
    { id: 'c2', revision: 2, plannedUrl: '/services/dallas', targetKeyword: 'dallas seo', status: 'published' as const, variableValues: { city: 'Dallas' } },
  ],
  stats: { total: 2, planned: 1, briefGenerated: 0, drafted: 0, reviewed: 0, published: 1 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('ContentPlanner', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const content = await import('../../src/api/content');
    const platform = await import('../../src/api/platform');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([]);
    vi.mocked(platform.workspaceFeatureFlags.list).mockResolvedValue([{
      key: 'content-matrix-generation',
      enabled: false,
    }] as never);
    vi.mocked(content.contentMatrices.getGeneration).mockImplementation(
      () => new Promise(() => {}),
    );
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

  it('creates new templates with an explicit v1 body-section contract', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.create).mockResolvedValue({} as never);
    renderContentPlanner();

    fireEvent.click(await screen.findByRole('button', { name: /create first template/i }));
    fireEvent.change(screen.getByPlaceholderText(/service.*location page/i), {
      target: { value: 'Service template' },
    });
    expect(screen.queryByRole('option', { name: /provider profile/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add variable/i }));
    fireEvent.change(screen.getByPlaceholderText(/variable name/i), {
      target: { value: 'service' },
    });
    fireEvent.change(screen.getByPlaceholderText(/display label/i), {
      target: { value: 'Service' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByPlaceholderText('/services/{city}/{service}'), {
      target: { value: '/services/{service}' },
    });
    fireEvent.change(screen.getByPlaceholderText('{service} in {city}'), {
      target: { value: '{service}' },
    });
    fireEvent.change(screen.getByPlaceholderText(/seo title/i), {
      target: { value: '{service} services' },
    });
    fireEvent.change(screen.getByPlaceholderText(/explore.*options/i), {
      target: { value: 'Explore {service} options.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add section/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => expect(content.contentTemplates.create).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({
        name: 'Service template',
        generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
        variables: [{ name: 'service', label: 'Service' }],
        urlPattern: '/services/{service}',
        keywordPattern: '{service}',
        titlePattern: '{service} services',
        metaDescPattern: 'Explore {service} options.',
        sections: [expect.objectContaining({
          generationRole: 'body',
          aeoContract: { modes: [], required: false },
          ctaContract: { role: 'none', required: false },
        })],
      }),
    ));
  });

  it('keeps a section added to a v1 template generation-valid', async () => {
    const content = await import('../../src/api/content');
    const v1Template = {
      ...mockTemplate,
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      titlePattern: '{topic} guide',
      metaDescPattern: 'Learn about {topic}.',
      sections: [{
        id: 'body',
        name: 'Body',
        headingTemplate: '{topic}',
        guidance: 'Write the body.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body' as const,
        aeoContract: { modes: [] as [], required: false },
        ctaContract: { role: 'none' as const, required: false },
      }],
    };
    vi.mocked(content.contentTemplates.list).mockResolvedValue([v1Template]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([]);
    vi.mocked(content.contentTemplates.update).mockResolvedValue(v1Template as never);
    renderContentPlanner();

    fireEvent.click(await screen.findByText('Blog Post Template'));
    fireEvent.click(screen.getByRole('button', { name: /add section/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => expect(content.contentTemplates.update).toHaveBeenCalledWith(
      'ws1',
      'tpl-1',
      expect.objectContaining({
        generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
        sections: [
          expect.objectContaining({ id: 'body', generationRole: 'body' }),
          expect.objectContaining({
            generationRole: 'body',
            aeoContract: { modes: [], required: false },
            ctaContract: { role: 'none', required: false },
          }),
        ],
      }),
    ));
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

  it('threads the latest cell revision into planner edits', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([mockMatrix]);
    vi.mocked(content.contentMatrices.updateCell).mockResolvedValue(mockMatrix as never);
    renderContentPlanner();

    fireEvent.click(await screen.findByText('City Pages Matrix'));
    fireEvent.click(await screen.findByRole('button', { name: 'Update first cell' }));

    await waitFor(() => expect(content.contentMatrices.updateCell).toHaveBeenCalledWith(
      'ws1',
      'mat-1',
      'c1',
      { customKeyword: 'austin seo agency', expectedCellRevision: 7 },
    ));
  });

  it('mounts the generation action after the real workspace flag loads enabled', async () => {
    const content = await import('../../src/api/content');
    const platform = await import('../../src/api/platform');
    vi.mocked(platform.workspaceFeatureFlags.list).mockResolvedValue([{
      key: 'content-matrix-generation',
      enabled: true,
    }] as never);
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([mockMatrix]);
    renderContentPlanner();

    fireEvent.click(await screen.findByText('City Pages Matrix'));

    expect(await screen.findByRole('button', { name: 'Generate Pages' })).toBeInTheDocument();
  });

  it('previews exact revisions and requires budget confirmation before starting', async () => {
    const content = await import('../../src/api/content');
    const platform = await import('../../src/api/platform');
    vi.mocked(platform.workspaceFeatureFlags.list).mockResolvedValue([{
      key: 'content-matrix-generation',
      enabled: true,
    }] as never);
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([mockMatrix]);
    vi.mocked(content.contentMatrices.previewGeneration).mockResolvedValue({
      results: [{
        status: 'ready',
        matrixId: 'mat-1',
        templateId: 'tpl-1',
        cellId: 'c1',
        sourceRevision: { matrixRevision: 5, templateRevision: 3, cellRevision: 7 },
        target: { effectiveInputFingerprint: 'a'.repeat(64) },
      }],
      estimatedBatchBudget: {
        providerCalls: 4,
        inputTokens: 12_000,
        outputTokens: 3_000,
        estimatedUsd: 1.23,
        maxConcurrency: 1,
      },
    } as never);
    vi.mocked(content.contentMatrices.startGeneration).mockResolvedValue({
      run: { id: 'run-1' },
      jobId: 'job-1',
      existing: false,
    } as never);
    renderContentPlanner();

    fireEvent.click(await screen.findByText('City Pages Matrix'));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate Pages' }));

    expect(await screen.findByText(/estimated \$1\.23/i)).toBeInTheDocument();
    expect(content.contentMatrices.previewGeneration).toHaveBeenCalledWith('ws1', 'mat-1', [{
      cellId: 'c1',
      expectedSourceRevision: { matrixRevision: 5, templateRevision: 3, cellRevision: 7 },
    }]);
    expect(content.contentMatrices.startGeneration).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Generate 1 page' }));

    await waitFor(() => expect(content.contentMatrices.startGeneration).toHaveBeenCalledWith(
      'ws1',
      'mat-1',
      expect.objectContaining({
        selections: [{
          cellId: 'c1',
          expectedSourceRevision: { matrixRevision: 5, templateRevision: 3, cellRevision: 7 },
          expectedPreviewFingerprint: 'a'.repeat(64),
        }],
        acceptedBudget: {
          maxProviderCalls: 4,
          maxInputTokens: 12_000,
          maxOutputTokens: 3_000,
          maxEstimatedUsd: 1.23,
          maxConcurrency: 1,
        },
        idempotencyKey: expect.any(String),
      }),
    ));
  });

  it('reviews a generated page and approves its exact revisions without publishing', async () => {
    const content = await import('../../src/api/content');
    const platform = await import('../../src/api/platform');
    vi.mocked(platform.workspaceFeatureFlags.list).mockResolvedValue([{
      key: 'content-matrix-generation',
      enabled: true,
    }] as never);
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([mockMatrix]);
    vi.mocked(content.contentMatrices.previewGeneration).mockResolvedValue({
      results: [{
        status: 'ready',
        matrixId: 'mat-1',
        templateId: 'tpl-1',
        cellId: 'c1',
        sourceRevision: { matrixRevision: 5, templateRevision: 3, cellRevision: 7 },
        target: { effectiveInputFingerprint: 'a'.repeat(64) },
      }],
      estimatedBatchBudget: {
        providerCalls: 4,
        inputTokens: 12_000,
        outputTokens: 3_000,
        estimatedUsd: 1.23,
        maxConcurrency: 1,
      },
    } as never);
    vi.mocked(content.contentMatrices.startGeneration).mockResolvedValue({
      run: { id: 'run-1' },
      jobId: 'job-1',
      existing: false,
    } as never);
    vi.mocked(content.contentMatrices.getGeneration).mockResolvedValue({
      run: {
        id: 'run-1',
        revision: 11,
        status: 'completed',
        counts: {
          selected: 1,
          queued: 0,
          running: 0,
          readyForHumanReview: 1,
          needsAttention: 0,
          blocked: 0,
          conflicts: 0,
          failed: 0,
          cancelled: 0,
        },
        setAuditReport: { findings: [], verdict: 'ready_for_human_review' },
      },
      items: {
        items: [{
          id: 'item-1',
          cellId: 'c1',
          revision: 12,
          status: 'ready_for_human_review',
          postId: 'post-1',
          approvalEvidence: null,
          auditReport: { verdict: 'ready_for_human_review', unresolvedRequirementIds: [] },
          error: null,
          setAuditFindings: [],
          target: { targetKeyword: 'austin seo', plannedUrl: '/services/austin', pageType: 'location' },
          currentArtifactRevisions: {
            brief: { artifactType: 'content_brief', artifactId: 'brief-1', generationRevision: 4 },
            post: { artifactType: 'generated_post', artifactId: 'post-1', generationRevision: 13 },
          },
        }],
        nextCursor: null,
      },
    } as never);
    vi.mocked(content.contentMatrices.approveGenerationItem).mockResolvedValue({} as never);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderContentPlanner();

    fireEvent.click(await screen.findByText('City Pages Matrix'));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate Pages' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate 1 page' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Review page' }));
    expect(open).toHaveBeenCalledWith(
      '/ws/ws1/content-pipeline?tab=posts&post=post-1',
      '_blank',
      'noopener,noreferrer',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve for export' }));
    expect(content.contentMatrices.approveGenerationItem).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/does not send or publish/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve for export' }));

    await waitFor(() => expect(content.contentMatrices.approveGenerationItem).toHaveBeenCalledWith(
      'ws1',
      'run-1',
      'item-1',
      {
        expectedRunRevision: 11,
        expectedItemRevision: 12,
        expectedPostRevision: 13,
      },
    ));
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Approve for export' }),
    ).toBeEnabled());
    open.mockRestore();
  });

  it('restores an MCP-started generation run from the planner deep link', async () => {
    const content = await import('../../src/api/content');
    const platform = await import('../../src/api/platform');
    vi.mocked(platform.workspaceFeatureFlags.list).mockResolvedValue([{
      key: 'content-matrix-generation',
      enabled: true,
    }] as never);
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([mockMatrix]);
    vi.mocked(content.contentMatrices.getGeneration).mockResolvedValue({
      run: {
        id: 'run-mcp-1',
        revision: 11,
        status: 'completed',
        counts: {
          selected: 1,
          queued: 0,
          running: 0,
          readyForHumanReview: 1,
          needsAttention: 0,
          blocked: 0,
          conflicts: 0,
          failed: 0,
          cancelled: 0,
        },
        setAuditReport: { findings: [], verdict: 'ready_for_human_review' },
      },
      items: {
        items: [{
          id: 'item-1',
          cellId: 'c1',
          revision: 12,
          status: 'ready_for_human_review',
          postId: 'post-1',
          approvalEvidence: null,
          auditReport: { verdict: 'ready_for_human_review', unresolvedRequirementIds: [] },
          error: null,
          setAuditFindings: [],
          target: { targetKeyword: 'austin seo', plannedUrl: '/services/austin', pageType: 'location' },
          currentArtifactRevisions: {
            brief: { artifactType: 'content_brief', artifactId: 'brief-1', generationRevision: 4 },
            post: { artifactType: 'generated_post', artifactId: 'post-1', generationRevision: 13 },
          },
        }],
        nextCursor: null,
      },
    } as never);

    renderContentPlanner(
      'ws1',
      '/ws/ws1/content-pipeline?tab=planner&matrix=mat-1&run=run-mcp-1',
    );

    expect(await screen.findByRole('button', { name: 'Review page' })).toBeInTheDocument();
    expect(content.contentMatrices.getGeneration).toHaveBeenCalledWith('ws1', 'run-mcp-1');
    expect(screen.getByTestId('matrix-grid')).toBeInTheDocument();
  });

  it('saves an opened template draft against its frozen source revision', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([]);
    vi.mocked(content.contentTemplates.update).mockRejectedValue(new Error('Template revision conflict'));
    const queryClient = makeQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ws/ws1']}>
          <ContentPlanner workspaceId="ws1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByText('Blog Post Template'));
    const nameInput = await screen.findByDisplayValue('Blog Post Template');
    fireEvent.change(nameInput, { target: { value: 'Draft template name' } });

    await act(async () => {
      queryClient.setQueryData(
        queryKeys.admin.contentTemplates('ws1'),
        [{ ...mockTemplate, revision: 4, name: 'Externally updated template' }],
      );
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => expect(content.contentTemplates.update).toHaveBeenCalledWith(
      'ws1',
      'tpl-1',
      expect.objectContaining({ revision: 3, name: 'Draft template name' }),
    ));
    expect(content.contentTemplates.create).not.toHaveBeenCalled();
    expect(screen.getByTestId('template-editor')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Draft template name')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Template revision conflict');
  });

  it('keeps the matrix open and shows a cell revision rejection', async () => {
    const content = await import('../../src/api/content');
    vi.mocked(content.contentTemplates.list).mockResolvedValue([mockTemplate]);
    vi.mocked(content.contentMatrices.list).mockResolvedValue([mockMatrix]);
    vi.mocked(content.contentMatrices.updateCell).mockRejectedValue(
      new Error('Cell revision conflict'),
    );
    renderContentPlanner();

    fireEvent.click(await screen.findByText('City Pages Matrix'));
    fireEvent.click(await screen.findByRole('button', { name: 'Update first cell' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cell revision conflict');
    expect(screen.getByTestId('matrix-grid')).toBeInTheDocument();
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
