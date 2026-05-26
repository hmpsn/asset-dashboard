import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Search, Star, ArrowRight } from 'lucide-react';

import { StatCard, CompactStatBar } from '../../../src/components/ui/StatCard';
import { SectionCard } from '../../../src/components/ui/SectionCard';
import { TabBar } from '../../../src/components/ui/TabBar';
import { DataList } from '../../../src/components/ui/DataList';
import { WorkflowStepper } from '../../../src/components/ui/WorkflowStepper';
import { ProgressIndicator } from '../../../src/components/ui/ProgressIndicator';
import { NextStepsCard } from '../../../src/components/ui/NextStepsCard';
import { MetricRing, MetricRingSvg } from '../../../src/components/ui/MetricRing';
import { ClickableRow } from '../../../src/components/ui/ClickableRow';
import { OnboardingChecklist } from '../../../src/components/ui/OnboardingChecklist';

// ─── StatCard ────────────────────────────────────────────────────────────────

describe('StatCard', () => {
  it('renders label text', () => {
    render(<StatCard label="Page Views" value={1234} />);
    expect(screen.getByText('Page Views')).toBeInTheDocument();
  });

  it('renders numeric value', () => {
    render(<StatCard label="Sessions" value={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders string value', () => {
    render(<StatCard label="Rate" value="6.3%" />);
    expect(screen.getByText('6.3%')).toBeInTheDocument();
  });

  it('renders without crashing with minimal props', () => {
    const { container } = render(<StatCard label="Min" value={0} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders sub text when provided', () => {
    render(<StatCard label="Rank" value={5} sub="vs last week" />);
    expect(screen.getByText('vs last week')).toBeInTheDocument();
  });

  it('renders positive delta', () => {
    render(<StatCard label="Clicks" value={100} delta={12} />);
    expect(screen.getByText('+12')).toBeInTheDocument();
  });

  it('renders negative delta', () => {
    render(<StatCard label="Clicks" value={100} delta={-8} />);
    expect(screen.getByText('-8')).toBeInTheDocument();
  });

  it('does not render delta span when delta is 0', () => {
    const { container } = render(<StatCard label="Clicks" value={100} delta={0} />);
    // delta=0 is explicitly not rendered
    expect(container.querySelector('.t-caption-sm.font-medium')).toBeNull();
  });

  it('renders deltaLabel appended to delta', () => {
    render(<StatCard label="Pos" value={3} delta={-2} deltaLabel=" pos" />);
    expect(screen.getByText('-2 pos')).toBeInTheDocument();
  });

  it('positive delta gets emerald class normally', () => {
    const { container } = render(<StatCard label="L" value={1} delta={5} />);
    const deltaSpan = container.querySelector('.text-emerald-400\\/80');
    expect(deltaSpan).toBeTruthy();
  });

  it('invertDelta: negative delta gets emerald (improvement)', () => {
    const { container } = render(<StatCard label="Bounce" value="40%" delta={-5} invertDelta />);
    const deltaSpan = container.querySelector('.text-emerald-400\\/80');
    expect(deltaSpan).toBeTruthy();
  });

  it('invertDelta: positive delta gets red (regression)', () => {
    const { container } = render(<StatCard label="Bounce" value="40%" delta={5} invertDelta />);
    const deltaSpan = container.querySelector('.text-red-400\\/80');
    expect(deltaSpan).toBeTruthy();
  });

  it('renders as button when onClick provided', () => {
    const fn = vi.fn();
    render(<StatCard label="CTA" value={1} onClick={fn} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('fires onClick when clicked', () => {
    const fn = vi.fn();
    render(<StatCard label="CTA" value={1} onClick={fn} />);
    fireEvent.click(screen.getByRole('button'));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('renders as div when no onClick', () => {
    const { container } = render(<StatCard label="Static" value={99} />);
    expect(container.querySelector('div')).toBeTruthy();
    expect(container.querySelector('button')).toBeNull();
  });

  it('applies hero size p-4 class', () => {
    const { container } = render(<StatCard label="Hero" value={1} size="hero" />);
    expect(container.firstChild).toBeTruthy();
    expect((container.firstChild as HTMLElement).className).toContain('p-4');
  });

  it('default size applies p-3 class', () => {
    const { container } = render(<StatCard label="Default" value={1} />);
    expect((container.firstChild as HTMLElement).className).toContain('p-3');
  });

  it('renders icon when provided', () => {
    const { container } = render(<StatCard label="With Icon" value={5} icon={Search} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('appends className to container', () => {
    const { container } = render(<StatCard label="X" value={1} className="extra-class" />);
    expect((container.firstChild as HTMLElement).className).toContain('extra-class');
  });

  it('renders ReactNode label', () => {
    render(<StatCard label={<span data-testid="fancy-label">Fancy</span>} value={1} />);
    expect(screen.getByTestId('fancy-label')).toBeInTheDocument();
  });
});

// ─── CompactStatBar ───────────────────────────────────────────────────────────

describe('CompactStatBar', () => {
  const items = [
    { label: 'Sessions', value: 1200 },
    { label: 'Clicks', value: 340 },
    { label: 'Impressions', value: 9800 },
  ];

  it('renders without crashing', () => {
    const { container } = render(<CompactStatBar items={items} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders all item labels', () => {
    render(<CompactStatBar items={items} />);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Clicks')).toBeInTheDocument();
    expect(screen.getByText('Impressions')).toBeInTheDocument();
  });

  it('renders all item values', () => {
    render(<CompactStatBar items={items} />);
    expect(screen.getByText('1200')).toBeInTheDocument();
    expect(screen.getByText('340')).toBeInTheDocument();
    expect(screen.getByText('9800')).toBeInTheDocument();
  });

  it('renders sub text for an item when provided', () => {
    render(<CompactStatBar items={[{ label: 'Rate', value: '6.2%', sub: '↑ 1.1%' }]} />);
    expect(screen.getByText('↑ 1.1%')).toBeInTheDocument();
  });

  it('renders empty items array without crashing', () => {
    const { container } = render(<CompactStatBar items={[]} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('appends className to container', () => {
    const { container } = render(<CompactStatBar items={items} className="my-class" />);
    expect((container.firstChild as HTMLElement).className).toContain('my-class');
  });

  it('renders string values', () => {
    render(<CompactStatBar items={[{ label: 'CTR', value: '3.1%' }]} />);
    expect(screen.getByText('3.1%')).toBeInTheDocument();
  });
});

// ─── SectionCard ─────────────────────────────────────────────────────────────

describe('SectionCard', () => {
  it('renders children', () => {
    render(<SectionCard><span>Hello</span></SectionCard>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(<SectionCard title="My Section"><p>content</p></SectionCard>);
    expect(screen.getByText('My Section')).toBeInTheDocument();
  });

  it('renders without title (no header)', () => {
    const { container } = render(<SectionCard><p>only child</p></SectionCard>);
    expect(screen.getByText('only child')).toBeInTheDocument();
    // header border-b should not exist when no title/action/titleExtra
    const headerDiv = container.querySelector('.border-b.border-\\[var\\(--brand-border\\)\\]');
    expect(headerDiv).toBeNull();
  });

  it('renders action slot content', () => {
    render(<SectionCard action={<button>Edit</button>}><p>x</p></SectionCard>);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('renders titleExtra slot content', () => {
    render(<SectionCard title="T" titleExtra={<span>3/10</span>}><p>x</p></SectionCard>);
    expect(screen.getByText('3/10')).toBeInTheDocument();
  });

  it('renders titleIcon slot', () => {
    render(<SectionCard title="T" titleIcon={<span data-testid="ti">icon</span>}><p>x</p></SectionCard>);
    expect(screen.getByTestId('ti')).toBeInTheDocument();
  });

  it('noPadding removes padding from content area', () => {
    const { container } = render(<SectionCard noPadding><p>x</p></SectionCard>);
    // Without noPadding the div has class 'p-4'. With noPadding it has ''
    const contentDiv = container.querySelector('div > div:last-child');
    expect(contentDiv?.className).not.toContain('p-4');
  });

  it('default variant has p-4 content padding', () => {
    const { container } = render(<SectionCard><p>x</p></SectionCard>);
    // The content wrapper is the last div child of the outer container
    const allDivs = container.querySelectorAll('div');
    const contentDiv = Array.from(allDivs).find(d => d.className.includes('p-4'));
    expect(contentDiv).toBeTruthy();
  });

  it('subtle variant applies overflow-hidden', () => {
    const { container } = render(<SectionCard variant="subtle"><p>x</p></SectionCard>);
    expect((container.firstChild as HTMLElement).className).toContain('overflow-hidden');
  });

  it('default variant does not include overflow-hidden', () => {
    const { container } = render(<SectionCard variant="default"><p>x</p></SectionCard>);
    expect((container.firstChild as HTMLElement).className).not.toContain('overflow-hidden');
  });

  it('appends className to container', () => {
    const { container } = render(<SectionCard className="custom-section"><p>x</p></SectionCard>);
    expect((container.firstChild as HTMLElement).className).toContain('custom-section');
  });

  it('interactive prop adds cursor-pointer class', () => {
    const { container } = render(<SectionCard interactive><p>x</p></SectionCard>);
    expect((container.firstChild as HTMLElement).className).toContain('cursor-pointer');
  });

  it('sets id attribute when provided', () => {
    const { container } = render(<SectionCard id="my-section"><p>x</p></SectionCard>);
    expect((container.firstChild as HTMLElement).id).toBe('my-section');
  });
});

// ─── TabBar ───────────────────────────────────────────────────────────────────

describe('TabBar', () => {
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'details', label: 'Details' },
    { id: 'settings', label: 'Settings' },
  ];

  it('renders all tab labels', () => {
    render(<TabBar tabs={tabs} active="overview" onChange={vi.fn()} />);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders tablist role', () => {
    render(<TabBar tabs={tabs} active="overview" onChange={vi.fn()} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders correct number of tab buttons', () => {
    render(<TabBar tabs={tabs} active="overview" onChange={vi.fn()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('active tab has aria-selected=true', () => {
    render(<TabBar tabs={tabs} active="details" onChange={vi.fn()} />);
    const detailsTab = screen.getByRole('tab', { name: 'Details' });
    expect(detailsTab).toHaveAttribute('aria-selected', 'true');
  });

  it('inactive tabs have aria-selected=false', () => {
    render(<TabBar tabs={tabs} active="details" onChange={vi.fn()} />);
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    expect(overviewTab).toHaveAttribute('aria-selected', 'false');
  });

  it('clicking a tab calls onChange with that id', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={tabs} active="overview" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    expect(onChange).toHaveBeenCalledWith('details');
  });

  it('clicking active tab still calls onChange', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={tabs} active="overview" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(onChange).toHaveBeenCalledWith('overview');
  });

  it('active tab has tabIndex=0', () => {
    render(<TabBar tabs={tabs} active="overview" onChange={vi.fn()} />);
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    expect(overviewTab).toHaveAttribute('tabIndex', '0');
  });

  it('inactive tabs have tabIndex=-1', () => {
    render(<TabBar tabs={tabs} active="overview" onChange={vi.fn()} />);
    const detailsTab = screen.getByRole('tab', { name: 'Details' });
    expect(detailsTab).toHaveAttribute('tabIndex', '-1');
  });

  it('active tab has teal border class', () => {
    render(<TabBar tabs={tabs} active="overview" onChange={vi.fn()} />);
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    expect(overviewTab.className).toContain('border-[var(--teal)]');
  });

  it('inactive tab has transparent border class', () => {
    render(<TabBar tabs={tabs} active="overview" onChange={vi.fn()} />);
    const detailsTab = screen.getByRole('tab', { name: 'Details' });
    expect(detailsTab.className).toContain('border-transparent');
  });

  it('ArrowRight keydown calls onChange with next tab', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={tabs} active="overview" onChange={onChange} />);
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('details');
  });

  it('ArrowLeft keydown calls onChange with prev tab', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={tabs} active="details" onChange={onChange} />);
    const detailsTab = screen.getByRole('tab', { name: 'Details' });
    fireEvent.keyDown(detailsTab, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('overview');
  });

  it('ArrowRight on last tab does not call onChange', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={tabs} active="settings" onChange={onChange} />);
    const settingsTab = screen.getByRole('tab', { name: 'Settings' });
    fireEvent.keyDown(settingsTab, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders tab icon when provided', () => {
    const tabsWithIcon = [{ id: 'search', label: 'Search', icon: Search }];
    render(<TabBar tabs={tabsWithIcon} active="search" onChange={vi.fn()} />);
    const tab = screen.getByRole('tab', { name: 'Search' });
    expect(tab.querySelector('svg')).toBeTruthy();
  });

  it('appends className to tablist container', () => {
    const { container } = render(<TabBar tabs={tabs} active="overview" onChange={vi.fn()} className="my-tabs" />);
    expect((container.firstChild as HTMLElement).className).toContain('my-tabs');
  });
});

// ─── DataList ─────────────────────────────────────────────────────────────────

describe('DataList', () => {
  const items = [
    { label: '/home', value: 1200 },
    { label: '/about', value: 340 },
    { label: '/contact', value: 89 },
  ];

  it('renders all item labels', () => {
    render(<DataList items={items} />);
    expect(screen.getByText('/home')).toBeInTheDocument();
    expect(screen.getByText('/about')).toBeInTheDocument();
    expect(screen.getByText('/contact')).toBeInTheDocument();
  });

  it('renders all item values', () => {
    render(<DataList items={items} />);
    expect(screen.getByText('1200')).toBeInTheDocument();
    expect(screen.getByText('340')).toBeInTheDocument();
    expect(screen.getByText('89')).toBeInTheDocument();
  });

  it('renders ranked numbers by default', () => {
    render(<DataList items={items} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('ranked=false hides rank numbers', () => {
    render(<DataList items={items} ranked={false} />);
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.queryByText('2')).toBeNull();
  });

  it('renders sub text for items that have it', () => {
    render(<DataList items={[{ label: '/page', value: 10, sub: 'direct' }]} />);
    expect(screen.getByText('direct')).toBeInTheDocument();
  });

  it('renders empty state when items is empty', () => {
    render(<DataList items={[]} />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('renders without crashing with minimal props', () => {
    const { container } = render(<DataList items={[{ label: 'x', value: 1 }]} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('appends className to container', () => {
    const { container } = render(<DataList items={items} className="dl-class" />);
    expect((container.firstChild as HTMLElement).className).toContain('dl-class');
  });

  it('renders extra ReactNode for an item', () => {
    render(
      <DataList
        items={[{ label: 'Home', value: 1, extra: <span data-testid="extra-node">X</span> }]}
      />
    );
    expect(screen.getByTestId('extra-node')).toBeInTheDocument();
  });

  it('renders string values', () => {
    render(<DataList items={[{ label: 'Rate', value: '3.5%' }]} />);
    expect(screen.getByText('3.5%')).toBeInTheDocument();
  });
});

// ─── WorkflowStepper ─────────────────────────────────────────────────────────

describe('WorkflowStepper', () => {
  const steps = [
    { number: 1, label: 'Connect', completed: true },
    { number: 2, label: 'Configure', completed: false, current: true },
    { number: 3, label: 'Launch', completed: false },
  ];

  it('renders nav with aria-label', () => {
    render(<WorkflowStepper steps={steps} />);
    expect(screen.getByRole('navigation', { name: 'Workflow steps' })).toBeInTheDocument();
  });

  it('renders all step labels', () => {
    render(<WorkflowStepper steps={steps} />);
    expect(screen.getByText('Connect')).toBeInTheDocument();
    expect(screen.getByText('Configure')).toBeInTheDocument();
    expect(screen.getByText('Launch')).toBeInTheDocument();
  });

  it('completed step has aria-label containing (completed)', () => {
    render(<WorkflowStepper steps={steps} />);
    // Step 1 is completed — it renders a div (not button) with aria-label
    const completedEl = screen.getByLabelText('Step 1: Connect (completed)');
    expect(completedEl).toBeInTheDocument();
  });

  it('current step with onClick renders button with aria-current=step', () => {
    const fn = vi.fn();
    const stepsWithCurrent = [
      { number: 1, label: 'Done', completed: true },
      { number: 2, label: 'Active', completed: false, current: true, onClick: fn },
      { number: 3, label: 'Next', completed: false },
    ];
    render(<WorkflowStepper steps={stepsWithCurrent} />);
    const btn = screen.getByRole('button', { name: /Step 2/ });
    expect(btn).toHaveAttribute('aria-current', 'step');
  });

  it('step with onClick renders as button', () => {
    const fn = vi.fn();
    const clickableSteps = [
      { number: 1, label: 'Step A', completed: false, onClick: fn },
    ];
    render(<WorkflowStepper steps={clickableSteps} />);
    expect(screen.getByRole('button', { name: /Step 1/ })).toBeInTheDocument();
  });

  it('clicking a clickable step fires onClick', () => {
    const fn = vi.fn();
    const clickableSteps = [{ number: 1, label: 'Step A', completed: false, onClick: fn }];
    render(<WorkflowStepper steps={clickableSteps} />);
    fireEvent.click(screen.getByRole('button', { name: /Step 1/ }));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('renders without crashing with minimal single step', () => {
    const { container } = render(
      <WorkflowStepper steps={[{ number: 1, label: 'Only', completed: false }]} />
    );
    expect(container.firstChild).toBeTruthy();
  });

  it('compact mode renders without crashing', () => {
    const { container } = render(<WorkflowStepper steps={steps} compact />);
    expect(container.firstChild).toBeTruthy();
  });

  it('completed step shows CheckCircle icon (svg), not step number', () => {
    const { container } = render(<WorkflowStepper steps={[{ number: 1, label: 'Done', completed: true }]} />);
    // CheckCircle renders as SVG. The step number span should NOT be present
    expect(screen.queryByText('1')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('pending step shows step number', () => {
    render(<WorkflowStepper steps={[{ number: 3, label: 'Pending', completed: false }]} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('multiple steps — connector lines exist between steps', () => {
    const { container } = render(<WorkflowStepper steps={steps} />);
    // connector divs have h-px class
    const connectors = container.querySelectorAll('.h-px');
    // 3 steps → 2 connectors
    expect(connectors.length).toBe(2);
  });
});

// ─── ProgressIndicator ───────────────────────────────────────────────────────

describe('ProgressIndicator', () => {
  it('returns null for idle status', () => {
    const { container } = render(<ProgressIndicator status="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for error status', () => {
    const { container } = render(<ProgressIndicator status="error" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders complete state with "Complete" text', () => {
    render(<ProgressIndicator status="complete" />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('renders progressbar role for running status', () => {
    render(<ProgressIndicator status="running" />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders step text for running status', () => {
    render(<ProgressIndicator status="running" step="Analyzing pages" />);
    expect(screen.getByText('Analyzing pages')).toBeInTheDocument();
  });

  it('renders detail text for running status', () => {
    render(<ProgressIndicator status="running" detail="Scanning 24 / 100 pages" />);
    expect(screen.getByText('Scanning 24 / 100 pages')).toBeInTheDocument();
  });

  it('shows percent value when provided', () => {
    render(<ProgressIndicator status="running" percent={65} />);
    expect(screen.getByText('65%')).toBeInTheDocument();
  });

  it('rounds percent to nearest integer', () => {
    render(<ProgressIndicator status="running" percent={33.7} />);
    expect(screen.getByText('34%')).toBeInTheDocument();
  });

  it('shows cancel button when onCancel provided', () => {
    render(<ProgressIndicator status="running" onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('fires onCancel when cancel button clicked', () => {
    const fn = vi.fn();
    render(<ProgressIndicator status="running" onCancel={fn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('does not show cancel button when onCancel not provided', () => {
    render(<ProgressIndicator status="running" />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('indeterminate: no percent text rendered', () => {
    render(<ProgressIndicator status="running" />);
    // Without percent prop, no % text appears
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('progressbar has aria-valuenow when percent provided', () => {
    render(<ProgressIndicator status="running" percent={50} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('appends className', () => {
    const { container } = render(<ProgressIndicator status="running" className="prog-class" />);
    expect((container.firstChild as HTMLElement).className).toContain('prog-class');
  });
});

// ─── NextStepsCard ────────────────────────────────────────────────────────────

describe('NextStepsCard', () => {
  const steps = [
    { label: 'Connect GSC', onClick: vi.fn(), description: 'Link Google Search Console' },
    { label: 'Add pages', onClick: vi.fn(), estimatedTime: '5 min' },
  ];

  it('renders without crashing', () => {
    const { container } = render(<NextStepsCard title="Next steps" steps={steps} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders the title', () => {
    render(<NextStepsCard title="Get started" steps={steps} />);
    expect(screen.getByText('Get started')).toBeInTheDocument();
  });

  it('renders each step label', () => {
    render(<NextStepsCard title="T" steps={steps} />);
    expect(screen.getByText('Connect GSC')).toBeInTheDocument();
    expect(screen.getByText('Add pages')).toBeInTheDocument();
  });

  it('renders step description when provided', () => {
    render(<NextStepsCard title="T" steps={steps} />);
    expect(screen.getByText('Link Google Search Console')).toBeInTheDocument();
  });

  it('renders estimated time when provided', () => {
    render(<NextStepsCard title="T" steps={steps} />);
    expect(screen.getByText('5 min')).toBeInTheDocument();
  });

  it('calls onClick when a step is clicked', () => {
    const fn = vi.fn();
    render(<NextStepsCard title="T" steps={[{ label: 'Do thing', onClick: fn }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Do thing' }));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('returns null when steps is empty', () => {
    const { container } = render(<NextStepsCard title="T" steps={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders dismiss button when onDismiss provided', () => {
    render(<NextStepsCard title="T" steps={steps} onDismiss={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('fires onDismiss when dismiss button clicked', () => {
    const fn = vi.fn();
    render(<NextStepsCard title="T" steps={steps} onDismiss={fn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('does not render dismiss button when onDismiss not provided', () => {
    render(<NextStepsCard title="T" steps={steps} />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('renders step icon when provided', () => {
    render(
      <NextStepsCard
        title="T"
        steps={[{ label: 'Search step', onClick: vi.fn(), icon: Search }]}
      />
    );
    const stepBtn = screen.getByRole('button', { name: 'Search step' });
    expect(stepBtn.querySelector('svg')).toBeTruthy();
  });

  it('success variant renders CheckCircle2 as default icon', () => {
    const { container } = render(<NextStepsCard title="T" steps={steps} variant="success" />);
    // CheckCircle2 renders svg
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

// ─── MetricRing ───────────────────────────────────────────────────────────────

describe('MetricRing', () => {
  it('renders without crashing', () => {
    const { container } = render(<MetricRing score={75} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders the score value', () => {
    render(<MetricRing score={82} />);
    expect(screen.getByText('82')).toBeInTheDocument();
  });

  it('renders SVG element', () => {
    const { container } = render(<MetricRing score={50} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders two circles (track + fill)', () => {
    const { container } = render(<MetricRing score={60} />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2);
  });

  it('renders score 0 without crashing', () => {
    const { container } = render(<MetricRing score={0} />);
    expect(container.firstChild).toBeTruthy();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders score 100 without crashing', () => {
    const { container } = render(<MetricRing score={100} />);
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('noAnimation prop renders without animation class concerns', () => {
    const { container } = render(<MetricRing score={70} noAnimation />);
    expect(container.firstChild).toBeTruthy();
  });

  it('applies custom size', () => {
    const { container } = render(<MetricRing score={50} size={80} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe('80px');
    expect(wrapper.style.height).toBe('80px');
  });

  it('appends className', () => {
    const { container } = render(<MetricRing score={50} className="ring-class" />);
    expect((container.firstChild as HTMLElement).className).toContain('ring-class');
  });
});

// ─── MetricRingSvg ────────────────────────────────────────────────────────────

describe('MetricRingSvg', () => {
  it('renders without crashing', () => {
    const { container } = render(<MetricRingSvg score={70} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders svg element', () => {
    const { container } = render(<MetricRingSvg score={60} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders the score text inside svg', () => {
    render(<MetricRingSvg score={55} />);
    expect(screen.getByText('55')).toBeInTheDocument();
  });

  it('renders two circles (track + fill)', () => {
    const { container } = render(<MetricRingSvg score={40} />);
    expect(container.querySelectorAll('circle').length).toBe(2);
  });

  it('applies custom size', () => {
    const { container } = render(<MetricRingSvg score={50} size={32} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('32');
    expect(svg?.getAttribute('height')).toBe('32');
  });
});

// ─── ClickableRow ─────────────────────────────────────────────────────────────

describe('ClickableRow', () => {
  it('renders children', () => {
    render(<ClickableRow>Row content</ClickableRow>);
    expect(screen.getByText('Row content')).toBeInTheDocument();
  });

  it('renders as a button', () => {
    render(<ClickableRow>X</ClickableRow>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('fires onClick when clicked', () => {
    const fn = vi.fn();
    render(<ClickableRow onClick={fn}>Click me</ClickableRow>);
    fireEvent.click(screen.getByRole('button'));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('disabled button does not fire onClick', () => {
    const fn = vi.fn();
    render(<ClickableRow onClick={fn} disabled>Disabled</ClickableRow>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('active prop adds surface-3 background class', () => {
    const { container } = render(<ClickableRow active>Active</ClickableRow>);
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('bg-[var(--surface-3)]/60');
  });

  it('inactive does not have surface-3 active class', () => {
    const { container } = render(<ClickableRow active={false}>Inactive</ClickableRow>);
    const btn = container.querySelector('button');
    expect(btn?.className).not.toContain('bg-[var(--surface-3)]/60');
  });

  it('chevron prop renders ChevronDown icon', () => {
    const { container } = render(<ClickableRow chevron>Row</ClickableRow>);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('chevron=false does not render chevron icon', () => {
    const { container } = render(<ClickableRow chevron={false}>Row</ClickableRow>);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('active + chevron rotates chevron icon', () => {
    const { container } = render(<ClickableRow chevron active>Row</ClickableRow>);
    const chevron = container.querySelector('svg');
    // SVG className is an SVGAnimatedString — use getAttribute('class')
    expect(chevron?.getAttribute('class')).toContain('rotate-180');
  });

  it('appends className', () => {
    const { container } = render(<ClickableRow className="row-class">X</ClickableRow>);
    expect(container.querySelector('button')?.className).toContain('row-class');
  });

  it('forwards ref to button element', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<ClickableRow ref={ref}>X</ClickableRow>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('disabled adds opacity-50 class', () => {
    const { container } = render(<ClickableRow disabled>X</ClickableRow>);
    expect(container.querySelector('button')?.className).toContain('opacity-50');
  });
});

// ─── OnboardingChecklist ──────────────────────────────────────────────────────

describe('OnboardingChecklist', () => {
  const steps = [
    { id: 'connect', label: 'Connect GSC', description: 'Link your search console', completed: false, onClick: vi.fn() },
    { id: 'pages', label: 'Add pages', description: 'Import your key pages', completed: false, onClick: vi.fn() },
    { id: 'brand', label: 'Set brand voice', description: 'Define your brand', completed: true, onClick: vi.fn() },
  ];

  it('renders without crashing', () => {
    const { container } = render(<OnboardingChecklist steps={steps} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders as a dialog', () => {
    render(<OnboardingChecklist steps={steps} onDismiss={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders default title', () => {
    render(<OnboardingChecklist steps={steps} onDismiss={vi.fn()} />);
    expect(screen.getByText('Get started with your workspace')).toBeInTheDocument();
  });

  it('renders custom title', () => {
    render(<OnboardingChecklist steps={steps} onDismiss={vi.fn()} title="Custom Title" />);
    expect(screen.getByText('Custom Title')).toBeInTheDocument();
  });

  it('renders all step labels', () => {
    render(<OnboardingChecklist steps={steps} onDismiss={vi.fn()} />);
    expect(screen.getByText('Connect GSC')).toBeInTheDocument();
    expect(screen.getByText('Add pages')).toBeInTheDocument();
    expect(screen.getByText('Set brand voice')).toBeInTheDocument();
  });

  it('renders step descriptions', () => {
    render(<OnboardingChecklist steps={steps} onDismiss={vi.fn()} />);
    expect(screen.getByText('Link your search console')).toBeInTheDocument();
  });

  it('shows completed count', () => {
    render(<OnboardingChecklist steps={steps} onDismiss={vi.fn()} />);
    expect(screen.getByText('1 of 3 steps completed')).toBeInTheDocument();
  });

  it('fires onDismiss when close button clicked', () => {
    const fn = vi.fn();
    render(<OnboardingChecklist steps={steps} onDismiss={fn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close onboarding checklist' }));
    expect(fn).toHaveBeenCalled();
  });

  it('fires onDismiss when "Dismiss for now" clicked', () => {
    const fn = vi.fn();
    render(<OnboardingChecklist steps={steps} onDismiss={fn} />);
    fireEvent.click(screen.getByText('Dismiss for now'));
    expect(fn).toHaveBeenCalled();
  });

  it('fires step onClick when a step is clicked', () => {
    const fn = vi.fn();
    const stepsWithFn = [{ id: 's1', label: 'Do thing', description: 'Desc', completed: false, onClick: fn }];
    render(<OnboardingChecklist steps={stepsWithFn} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Do thing' }));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('renders progress percentage', () => {
    render(<OnboardingChecklist steps={steps} onDismiss={vi.fn()} />);
    // 1/3 = 33%
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('shows "You\'re all set!" when all steps complete', () => {
    const allDone = steps.map(s => ({ ...s, completed: true }));
    render(<OnboardingChecklist steps={allDone} onDismiss={vi.fn()} />);
    expect(screen.getByText("You're all set!")).toBeInTheDocument();
  });

  it('estimated time badge renders for incomplete steps', () => {
    const stepsWithTime = [
      { id: 't1', label: 'Setup', description: 'Do setup', completed: false, onClick: vi.fn(), estimatedTime: '10 min' },
    ];
    render(<OnboardingChecklist steps={stepsWithTime} onDismiss={vi.fn()} />);
    expect(screen.getByText('10 min')).toBeInTheDocument();
  });

  it('estimated time badge not shown for completed steps', () => {
    const stepsWithTime = [
      { id: 't1', label: 'Setup', description: 'Do setup', completed: true, onClick: vi.fn(), estimatedTime: '10 min' },
    ];
    render(<OnboardingChecklist steps={stepsWithTime} onDismiss={vi.fn()} />);
    expect(screen.queryByText('10 min')).toBeNull();
  });

  it('aria-modal is true on dialog', () => {
    render(<OnboardingChecklist steps={steps} onDismiss={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });
});
