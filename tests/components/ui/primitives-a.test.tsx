import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FileText, AlertCircle, Search } from 'lucide-react';

import { Badge } from '../../../src/components/ui/Badge';
import { TrendBadge } from '../../../src/components/ui/TrendBadge';
import { EmptyState } from '../../../src/components/ui/EmptyState';
import { InlineBanner } from '../../../src/components/ui/InlineBanner';
import { ErrorState, NetworkError, DataError, PermissionError } from '../../../src/components/ui/ErrorState';
import { LoadingState } from '../../../src/components/ui/LoadingState';
import {
  Skeleton,
  StatCardSkeleton,
  SectionCardSkeleton,
  OverviewSkeleton,
  AnalyticsSkeleton,
} from '../../../src/components/ui/Skeleton';
import { PageHeader } from '../../../src/components/ui/PageHeader';
import { StatusBadge } from '../../../src/components/ui/StatusBadge';
import { CharacterCounter } from '../../../src/components/ui/CharacterCounter';

// ─── Badge ────────────────────────────────────────────────────────────────────

describe('Badge', () => {
  it('renders the label', () => {
    render(<Badge label="Hello" />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it.each(['teal', 'blue', 'emerald', 'amber', 'red', 'orange', 'zinc'] as const)(
    'tone=%s renders without crashing',
    (tone) => {
      const { container } = render(<Badge label={tone} tone={tone} />);
      expect(container.firstChild).toBeTruthy();
    },
  );

  it.each(['soft', 'outline', 'solid'] as const)(
    'variant=%s renders without crashing',
    (variant) => {
      const { container } = render(<Badge label="x" tone="teal" variant={variant} />);
      expect(container.firstChild).toBeTruthy();
    },
  );

  it('soft variant applies soft class for teal', () => {
    render(<Badge label="x" tone="teal" variant="soft" />);
    const el = screen.getByText('x');
    expect(el.className).toContain('bg-teal-500/10');
    expect(el.className).toContain('text-teal-400');
  });

  it('outline variant applies outline class for blue', () => {
    render(<Badge label="x" tone="blue" variant="outline" />);
    const el = screen.getByText('x');
    expect(el.className).toContain('border-blue-500/25');
  });

  it('solid variant applies solid class for red', () => {
    render(<Badge label="x" tone="red" variant="solid" />);
    const el = screen.getByText('x');
    expect(el.className).toContain('bg-red-600');
    expect(el.className).toContain('text-white');
  });

  it('sm size applies sm classes', () => {
    render(<Badge label="x" size="sm" />);
    const el = screen.getByText('x');
    expect(el.className).toContain('px-1.5');
    expect(el.className).toContain('py-0.5');
  });

  it('md size applies md classes', () => {
    render(<Badge label="x" size="md" />);
    const el = screen.getByText('x');
    expect(el.className).toContain('px-2');
    expect(el.className).toContain('py-1');
  });

  it('pill shape applies pill radius class', () => {
    render(<Badge label="x" shape="pill" />);
    const el = screen.getByText('x');
    expect(el.className).toContain('rounded-[var(--radius-pill)]');
  });

  it('sm shape applies sm radius class', () => {
    render(<Badge label="x" shape="sm" />);
    const el = screen.getByText('x');
    expect(el.className).toContain('rounded-[var(--radius-sm)]');
  });

  it('dot=true renders a dot span', () => {
    const { container } = render(<Badge label="x" dot={true} />);
    const dotEl = container.querySelector('[aria-hidden="true"]');
    expect(dotEl).toBeTruthy();
    expect(dotEl?.className).toContain('h-1.5');
    expect(dotEl?.className).toContain('w-1.5');
  });

  it('dot=false does not render dot span', () => {
    const { container } = render(<Badge label="x" dot={false} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('ariaLabel is applied to the span', () => {
    render(<Badge label="x" ariaLabel="my-label" />);
    expect(screen.getByLabelText('my-label')).toBeInTheDocument();
  });

  it('color alias falls back to tone', () => {
    render(<Badge label="colorAlias" color="amber" />);
    const el = screen.getByText('colorAlias');
    expect(el.className).toContain('bg-amber-500/8');
  });

  it('no tone/color resolves to zinc soft', () => {
    render(<Badge label="default" />);
    const el = screen.getByText('default');
    expect(el.className).toContain('bg-zinc-800');
  });

  it('icon prop renders an svg element', () => {
    render(<Badge label="with icon" icon={AlertCircle} />);
    const span = screen.getByText('with icon').closest('span');
    expect(span?.querySelector('svg')).toBeTruthy();
  });

  it('appends className', () => {
    render(<Badge label="x" className="custom-cls" />);
    expect(screen.getByText('x').className).toContain('custom-cls');
  });
});

// ─── TrendBadge ───────────────────────────────────────────────────────────────

describe('TrendBadge', () => {
  it('positive value renders the numeric value', () => {
    render(<TrendBadge value={12} />);
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('negative value renders the absolute value', () => {
    render(<TrendBadge value={-5} />);
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it('positive value applies emerald color', () => {
    const { container } = render(<TrendBadge value={10} />);
    const span = container.firstChild as HTMLElement;
    expect(span.className).toContain('text-emerald-400');
  });

  it('negative value applies red color', () => {
    const { container } = render(<TrendBadge value={-10} />);
    const span = container.firstChild as HTMLElement;
    expect(span.className).toContain('text-red-400');
  });

  it('zero with hideOnZero=true (default) returns null', () => {
    const { container } = render(<TrendBadge value={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('zero with hideOnZero=false renders neutral Minus icon', () => {
    const { container } = render(<TrendBadge value={0} hideOnZero={false} />);
    expect(container.firstChild).toBeTruthy();
    // Should have a text-[var(--brand-text)] neutral color span
    const span = container.firstChild as HTMLElement;
    expect(span).toBeInTheDocument();
  });

  it('zero with hideOnZero=false renders 0 with default % suffix', () => {
    render(<TrendBadge value={0} hideOnZero={false} />);
    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });

  it('default suffix is %', () => {
    render(<TrendBadge value={8} />);
    expect(screen.getByText(/8%/)).toBeInTheDocument();
  });

  it('custom suffix is rendered', () => {
    render(<TrendBadge value={3} suffix="pts" />);
    expect(screen.getByText(/3pts/)).toBeInTheDocument();
  });

  it('invert=true: negative value gets emerald color (lower is better)', () => {
    const { container } = render(<TrendBadge value={-5} invert={true} />);
    const span = container.firstChild as HTMLElement;
    expect(span.className).toContain('text-emerald-400');
  });

  it('invert=true: positive value gets red color', () => {
    const { container } = render(<TrendBadge value={5} invert={true} />);
    const span = container.firstChild as HTMLElement;
    expect(span.className).toContain('text-red-400');
  });

  it('showSign=true adds + prefix for positive values', () => {
    render(<TrendBadge value={7} showSign={true} />);
    expect(screen.getByText(/\+7/)).toBeInTheDocument();
  });

  it('showSign=false does not add + for positive values', () => {
    render(<TrendBadge value={7} showSign={false} />);
    expect(screen.queryByText(/\+/)).toBeNull();
  });

  it('iconOnly=true hides the numeric value', () => {
    render(<TrendBadge value={5} iconOnly={true} />);
    expect(screen.queryByText(/5/)).toBeNull();
  });

  it('label is rendered after value', () => {
    render(<TrendBadge value={5} label="vs last month" />);
    expect(screen.getByText(/vs last month/)).toBeInTheDocument();
  });

  it('iconOnly hides the label as well', () => {
    render(<TrendBadge value={5} label="vs last month" iconOnly={true} />);
    expect(screen.queryByText(/vs last month/)).toBeNull();
  });

  it('positive value renders TrendingUp svg', () => {
    const { container } = render(<TrendBadge value={20} />);
    // lucide TrendingUp renders an svg
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('negative value renders TrendingDown svg', () => {
    const { container } = render(<TrendBadge value={-20} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('md size applies wider icon class', () => {
    const { container } = render(<TrendBadge value={1} size="md" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('w-3.5');
  });
});

// ─── EmptyState ───────────────────────────────────────────────────────────────

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState icon={Search} title="No results found" />);
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <EmptyState
        icon={Search}
        title="Empty"
        description="Try adjusting your filters."
      />,
    );
    expect(screen.getByText('Try adjusting your filters.')).toBeInTheDocument();
  });

  it('omits description when not provided', () => {
    render(<EmptyState icon={Search} title="Empty" />);
    // description paragraph should not exist
    const paras = document.querySelectorAll('p');
    // only the title paragraph should be present
    expect(paras.length).toBe(1);
  });

  it('renders action when provided', () => {
    render(
      <EmptyState
        icon={Search}
        title="Empty"
        action={<button>Add item</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument();
  });

  it('does not render action when not provided', () => {
    render(<EmptyState icon={Search} title="Empty" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the icon svg', () => {
    const { container } = render(<EmptyState icon={Search} title="x" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('appends custom className to wrapper', () => {
    const { container } = render(
      <EmptyState icon={Search} title="x" className="my-custom" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-custom');
  });
});

// ─── InlineBanner ─────────────────────────────────────────────────────────────

describe('InlineBanner', () => {
  it('renders error banners as assertive alerts by default', () => {
    render(<InlineBanner>Could not save changes</InlineBanner>);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save changes');
  });

  it('renders title and message content', () => {
    render(<InlineBanner title="Page generation failed" message="Network timeout" />);
    expect(screen.getByText('Page generation failed')).toBeInTheDocument();
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
  });

  it('uses status role for non-error informational banners', () => {
    render(<InlineBanner tone="success">Saved</InlineBanner>);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('renders numeric children', () => {
    render(<InlineBanner>{0}</InlineBanner>);
    expect(screen.getByRole('alert')).toHaveTextContent('0');
  });

  it('calls onDismiss from the dismiss button', () => {
    const onDismiss = vi.fn();
    render(<InlineBanner onDismiss={onDismiss} dismissLabel="Dismiss error">Failed</InlineBanner>);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

// ─── ErrorState ───────────────────────────────────────────────────────────────

describe('ErrorState', () => {
  it('renders without crashing using defaults', () => {
    render(<ErrorState />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders default title', () => {
    render(<ErrorState />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders custom title', () => {
    render(<ErrorState title="Custom Error" />);
    expect(screen.getByText('Custom Error')).toBeInTheDocument();
  });

  it('renders custom message', () => {
    render(<ErrorState message="Detailed error message" />);
    expect(screen.getByText('Detailed error message')).toBeInTheDocument();
  });

  it('renders action button when action prop provided', () => {
    const fn = vi.fn();
    render(<ErrorState action={{ label: 'Retry', onClick: fn }} />);
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('action button fires onClick', () => {
    const fn = vi.fn();
    render(<ErrorState action={{ label: 'Retry', onClick: fn }} />);
    screen.getByRole('button', { name: /Retry/i }).click();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('renders multiple actions when actions array provided', () => {
    render(
      <ErrorState
        actions={[
          { label: 'Cancel', onClick: vi.fn(), variant: 'secondary' },
          { label: 'Retry', onClick: vi.fn(), variant: 'primary' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it.each(['network', 'data', 'permission', 'general'] as const)(
    'type=%s renders without crashing',
    (type) => {
      render(<ErrorState type={type} />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    },
  );

  it('NetworkError helper renders with correct title', () => {
    render(<NetworkError onRetry={vi.fn()} />);
    expect(screen.getByText('Connection error')).toBeInTheDocument();
  });

  it('DataError helper renders with correct title', () => {
    render(<DataError onRetry={vi.fn()} />);
    expect(screen.getByText('Data loading failed')).toBeInTheDocument();
  });

  it('PermissionError helper renders with correct title', () => {
    render(<PermissionError />);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });
});

// ─── LoadingState ─────────────────────────────────────────────────────────────

describe('LoadingState', () => {
  it('renders without crashing', () => {
    const { container } = render(<LoadingState />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders default message', () => {
    render(<LoadingState />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders custom message', () => {
    render(<LoadingState message="Analyzing site health..." />);
    expect(screen.getByText('Analyzing site health...')).toBeInTheDocument();
  });

  it('renders a spinning icon', () => {
    const { container } = render(<LoadingState />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it.each(['sm', 'md', 'lg'] as const)('size=%s renders without crashing', (size) => {
    const { container } = render(<LoadingState size={size} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('sm size applies smaller spinner class', () => {
    const { container } = render(<LoadingState size="sm" />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner?.getAttribute('class')).toContain('w-4');
  });

  it('lg size applies larger spinner class', () => {
    const { container } = render(<LoadingState size="lg" />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner?.getAttribute('class')).toContain('w-8');
  });

  it('applies custom className', () => {
    const { container } = render(<LoadingState className="custom-loading" />);
    expect((container.firstChild as HTMLElement).className).toContain('custom-loading');
  });
});

// ─── Skeleton ─────────────────────────────────────────────────────────────────

describe('Skeleton', () => {
  it('renders a single animated div', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.className).toContain('animate-pulse');
  });

  it('appends custom className', () => {
    const { container } = render(<Skeleton className="w-32 h-4" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('w-32');
    expect(el.className).toContain('h-4');
  });

  it('StatCardSkeleton renders without crashing', () => {
    const { container } = render(<StatCardSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it('SectionCardSkeleton renders without crashing', () => {
    const { container } = render(<SectionCardSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it('SectionCardSkeleton with custom lines renders correct number of skeleton rows', () => {
    const { container } = render(<SectionCardSkeleton lines={5} />);
    // lines=5 means 5 skeleton bars after the header section (+ 2 header bars)
    const pulsingEls = container.querySelectorAll('.animate-pulse');
    expect(pulsingEls.length).toBeGreaterThanOrEqual(5);
  });

  it('OverviewSkeleton renders without crashing', () => {
    const { container } = render(<OverviewSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it('AnalyticsSkeleton renders without crashing', () => {
    const { container } = render(<AnalyticsSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it('StatCardSkeleton renders multiple pulse elements', () => {
    const { container } = render(<StatCardSkeleton />);
    const pulsingEls = container.querySelectorAll('.animate-pulse');
    expect(pulsingEls.length).toBeGreaterThan(1);
  });
});

// ─── PageHeader ───────────────────────────────────────────────────────────────

describe('PageHeader', () => {
  it('renders the title', () => {
    render(<PageHeader title="Dashboard" />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('title is inside an h2', () => {
    render(<PageHeader title="My Page" />);
    expect(screen.getByRole('heading', { level: 2, name: 'My Page' })).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<PageHeader title="Overview" subtitle="Last 30 days" />);
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  it('omits subtitle paragraph when not provided', () => {
    render(<PageHeader title="Overview" />);
    expect(screen.queryByRole('paragraph')).toBeNull();
  });

  it('renders actions when provided', () => {
    render(<PageHeader title="x" actions={<button>New</button>} />);
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('does not render actions wrapper when not provided', () => {
    render(<PageHeader title="x" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders icon when provided', () => {
    render(
      <PageHeader
        title="Files"
        icon={<FileText data-testid="page-icon" />}
      />,
    );
    expect(screen.getByTestId('page-icon')).toBeInTheDocument();
  });

  it('appends custom className', () => {
    const { container } = render(<PageHeader title="x" className="custom-header" />);
    expect((container.firstChild as HTMLElement).className).toContain('custom-header');
  });

  it('subtitle can be a ReactNode (element)', () => {
    render(
      <PageHeader
        title="x"
        subtitle={<span data-testid="sub-node">node subtitle</span>}
      />,
    );
    expect(screen.getByTestId('sub-node')).toBeInTheDocument();
  });
});

// ─── StatusBadge ──────────────────────────────────────────────────────────────

describe('StatusBadge', () => {
  it('returns null for undefined status', () => {
    const { container } = render(<StatusBadge status={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for null status', () => {
    const { container } = render(<StatusBadge status={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for clean status (page-edit domain)', () => {
    const { container } = render(<StatusBadge status="clean" domain="page-edit" />);
    expect(container.firstChild).toBeNull();
  });

  it('issue-detected status renders without crashing', () => {
    render(<StatusBadge status="issue-detected" domain="page-edit" />);
    expect(screen.getByText('Issue Detected')).toBeInTheDocument();
  });

  it('fix-proposed status renders label', () => {
    render(<StatusBadge status="fix-proposed" domain="page-edit" />);
    expect(screen.getByText('Fix Proposed')).toBeInTheDocument();
  });

  it('in-review status renders label', () => {
    render(<StatusBadge status="in-review" domain="page-edit" />);
    expect(screen.getByText('In Review')).toBeInTheDocument();
  });

  it('approved status renders label', () => {
    render(<StatusBadge status="approved" domain="page-edit" />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('rejected status renders label', () => {
    render(<StatusBadge status="rejected" domain="page-edit" />);
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });

  it('live status renders label', () => {
    render(<StatusBadge status="live" domain="page-edit" />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('content domain: draft renders label', () => {
    render(<StatusBadge status="draft" domain="content" />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('content domain: published renders label', () => {
    render(<StatusBadge status="published" domain="content" />);
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it('approval domain: pending renders label', () => {
    render(<StatusBadge status="pending" domain="approval" />);
    expect(screen.getByText('Awaiting Review')).toBeInTheDocument();
  });

  it('job domain: running renders label', () => {
    render(<StatusBadge status="running" domain="job" />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('integration domain: connected renders label', () => {
    render(<StatusBadge status="connected" domain="integration" />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('severity domain: critical renders label', () => {
    render(<StatusBadge status="critical" domain="severity" />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('priority domain: p0 renders label', () => {
    render(<StatusBadge status="p0" domain="priority" />);
    expect(screen.getByText('P0')).toBeInTheDocument();
  });

  it('showLabel=false hides text and renders dot with ariaLabel', () => {
    render(<StatusBadge status="approved" domain="page-edit" showLabel={false} />);
    // When showLabel=false, label="" and ariaLabel is set
    expect(screen.queryByText('Approved')).toBeNull();
    expect(screen.getByLabelText('Approved')).toBeInTheDocument();
  });

  it('unknown status with no fallback returns null', () => {
    const { container } = render(<StatusBadge status="nonexistent-status" domain="page-edit" />);
    expect(container.firstChild).toBeNull();
  });

  it('unknown status with fallback=neutral renders badge with titleized label', () => {
    render(<StatusBadge status="my-custom-status" domain="page-edit" fallback="neutral" />);
    expect(screen.getByText('My Custom Status')).toBeInTheDocument();
  });
});

// ─── CharacterCounter ────────────────────────────────────────────────────────

describe('CharacterCounter', () => {
  it('renders current count', () => {
    render(<CharacterCounter current={50} max={160} />);
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('renders max count', () => {
    render(<CharacterCounter current={50} max={160} />);
    expect(screen.getByText('160')).toBeInTheDocument();
  });

  it('renders separator /', () => {
    render(<CharacterCounter current={10} max={100} />);
    expect(screen.getByText('/')).toBeInTheDocument();
  });

  it('applies emerald color when under 80%', () => {
    const { container } = render(<CharacterCounter current={40} max={100} />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('text-emerald-400/80');
  });

  it('applies amber color when 80–94% full', () => {
    const { container } = render(<CharacterCounter current={85} max={100} />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('text-amber-400/80');
  });

  it('applies red color when 95%+ full', () => {
    const { container } = render(<CharacterCounter current={95} max={100} />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('text-red-400/80');
  });

  it('applies red color when at 100%', () => {
    const { container } = render(<CharacterCounter current={100} max={100} />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('text-red-400/80');
  });

  it('applies amber at exact 80% boundary', () => {
    const { container } = render(<CharacterCounter current={80} max={100} />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('text-amber-400/80');
  });

  it('showPercentage=false does not render percentage', () => {
    render(<CharacterCounter current={50} max={100} showPercentage={false} />);
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('showPercentage=true renders percentage value', () => {
    render(<CharacterCounter current={50} max={100} showPercentage={true} />);
    expect(screen.getByText('(50%)')).toBeInTheDocument();
  });

  it('showPercentage rounds to nearest integer', () => {
    render(<CharacterCounter current={1} max={3} showPercentage={true} />);
    expect(screen.getByText('(33%)')).toBeInTheDocument();
  });

  it.each(['sm', 'md', 'lg'] as const)('size=%s renders without crashing', (size) => {
    const { container } = render(<CharacterCounter current={10} max={100} size={size} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('applies custom className', () => {
    const { container } = render(
      <CharacterCounter current={10} max={100} className="my-counter" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-counter');
  });

  it('zero current shows 0', () => {
    render(<CharacterCounter current={0} max={100} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
