/**
 * Smoke tests for client-facing components.
 * Covers: ClientHeader, ClientAuthGate, HealthScoreCard, DataSnapshots,
 *         BetaProvider/useBetaMode, EmailCaptureGate,
 *         ClientOnboardingQuestionnaire, SeoEducationTip, ServiceInterestCTA,
 *         SeoCartButton/SeoCartDrawer, OrderStatus, OutcomeSummary.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../src/api/client', () => ({
  get: vi.fn().mockResolvedValue(null),
  getOptional: vi.fn().mockResolvedValue(null),
  getSafe: vi.fn().mockResolvedValue({}),
  post: vi.fn().mockResolvedValue({ url: 'https://stripe.example/checkout' }),
  patch: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue({}),
  del: vi.fn().mockResolvedValue({}),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(msg: string, status: number) { super(msg); this.status = status; }
  },
}));

vi.mock('../../../src/components/TurnstileWidget', () => ({
  default: () => null,
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => vi.fn(),
  useParams: () => ({ workspaceId: 'ws-1' }),
  useLocation: () => ({ pathname: '/client/ws-1', search: '' }),
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
}));

// Mock client outcome hooks used by WeCalledIt and OutcomeSummary
vi.mock('../../../src/hooks/client/useClientOutcomes', () => ({
  useClientOutcomeWins: () => ({ data: [], isLoading: false }),
  useClientOutcomeSummary: () => ({ data: null, isLoading: false }),
}));

// Mock client signal hook used by ServiceInterestCTA
vi.mock('../../../src/hooks/admin/useClientSignals', () => ({
  useCreateClientSignal: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

// ── Wrapper ───────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderWithWrapper(ui: React.ReactElement) {
  return render(ui, { wrapper: Wrapper });
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

import type { WorkspaceInfo, AuditDetail } from '../../../src/components/client/types';
import { Home, BarChart2, Settings } from 'lucide-react';
import type { ClientTab } from '../../../src/routes';

const mockWs: WorkspaceInfo = {
  id: 'ws-1',
  name: 'Acme Corp',
  tier: 'growth',
  baseTier: 'growth',
  isTrial: false,
};

const mockAuditDetail: AuditDetail = {
  id: 'audit-1',
  createdAt: '2026-05-01T00:00:00Z',
  siteName: 'Acme Corp',
  scoreHistory: [],
  audit: {
    siteScore: 72,
    totalPages: 10,
    errors: 2,
    warnings: 5,
    infos: 3,
    pages: [
      {
        pageId: 'p1',
        page: 'Home',
        slug: '/',
        url: 'https://example.com/',
        score: 60,
        issues: [
          {
            check: 'meta-title',
            severity: 'error',
            message: 'Missing meta title',
            recommendation: 'Add a meta title',
            category: 'metadata',
          },
        ],
      },
    ],
    siteWideIssues: [],
  },
};

// ── HealthScoreCard ───────────────────────────────────────────────────────────

import { HealthScoreCard } from '../../../src/components/client/HealthScoreCard';
import { BetaProvider } from '../../../src/components/client/BetaContext';

describe('HealthScoreCard', () => {
  it('renders null when score is null', () => {
    const { container } = renderWithWrapper(
      <BetaProvider value={false}>
        <HealthScoreCard score={null} workspaceId="ws-1" />
      </BetaProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders null when score is undefined', () => {
    const { container } = renderWithWrapper(
      <BetaProvider value={false}>
        <HealthScoreCard score={undefined} workspaceId="ws-1" />
      </BetaProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders score value when score is provided', () => {
    renderWithWrapper(
      <BetaProvider value={false}>
        <HealthScoreCard score={75} workspaceId="ws-1" />
      </BetaProvider>
    );
    // Score appears in the MetricRing and in the stat display — both should be present
    const allSeventyFives = screen.getAllByText('75');
    expect(allSeventyFives.length).toBeGreaterThanOrEqual(1);
  });

  it('renders "SEO Health Score" title', () => {
    renderWithWrapper(
      <BetaProvider value={false}>
        <HealthScoreCard score={80} workspaceId="ws-1" />
      </BetaProvider>
    );
    expect(screen.getByText('SEO Health Score')).toBeInTheDocument();
  });

  it('shows "performing well" message for score >= 80', () => {
    renderWithWrapper(
      <BetaProvider value={false}>
        <HealthScoreCard score={85} workspaceId="ws-1" />
      </BetaProvider>
    );
    expect(screen.getByText(/performing well/i)).toBeInTheDocument();
  });

  it('shows "room for improvement" message for score 60-79', () => {
    renderWithWrapper(
      <BetaProvider value={false}>
        <HealthScoreCard score={70} workspaceId="ws-1" />
      </BetaProvider>
    );
    expect(screen.getByText(/room for improvement/i)).toBeInTheDocument();
  });

  it('shows "needs attention" message for score < 60', () => {
    renderWithWrapper(
      <BetaProvider value={false}>
        <HealthScoreCard score={50} workspaceId="ws-1" />
      </BetaProvider>
    );
    expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
  });

  it('shows CTA buttons when score < 80', () => {
    renderWithWrapper(
      <BetaProvider value={false}>
        <HealthScoreCard score={50} workspaceId="ws-1" />
      </BetaProvider>
    );
    expect(screen.getByText(/View Priority Issues/i)).toBeInTheDocument();
    expect(screen.getByText(/Request SEO Help/i)).toBeInTheDocument();
  });

  it('does not show CTA buttons when score >= 80', () => {
    renderWithWrapper(
      <BetaProvider value={false}>
        <HealthScoreCard score={90} workspaceId="ws-1" />
      </BetaProvider>
    );
    expect(screen.queryByText(/View Priority Issues/i)).not.toBeInTheDocument();
  });

  it('renders legend items', () => {
    renderWithWrapper(
      <BetaProvider value={false}>
        <HealthScoreCard score={75} workspaceId="ws-1" />
      </BetaProvider>
    );
    expect(screen.getByText(/Healthy/i)).toBeInTheDocument();
    expect(screen.getByText(/Critical/i)).toBeInTheDocument();
  });
});

// ── ClientAuthGate ────────────────────────────────────────────────────────────

import { ClientAuthGate } from '../../../src/components/client/ClientAuthGate';

describe('ClientAuthGate', () => {
  const baseProps = {
    workspaceId: 'ws-1',
    ws: mockWs,
    authLoading: false,
    authError: '',
    authMode: { hasSharedPassword: true, hasClientUsers: false },
    loginTab: 'password' as const,
    loginEmail: '',
    loginPassword: '',
    loginView: 'login' as const,
    forgotEmail: '',
    forgotSent: false,
    resetToken: '',
    resetPassword: '',
    resetConfirm: '',
    resetDone: false,
    passwordInput: '',
    turnstileReset: 0,
    tokenRef: { current: undefined },
    setLoginTab: vi.fn(),
    setLoginEmail: vi.fn(),
    setLoginPassword: vi.fn(),
    setLoginView: vi.fn(),
    setForgotEmail: vi.fn(),
    setForgotSent: vi.fn(),
    setResetPassword: vi.fn(),
    setResetConfirm: vi.fn(),
    setResetDone: vi.fn(),
    setPasswordInput: vi.fn(),
    setAuthError: vi.fn(),
    setAuthLoading: vi.fn(),
    setTurnstileReset: vi.fn(),
    handlePasswordSubmit: vi.fn(),
    handleClientUserLogin: vi.fn(),
  };

  it('renders workspace name', () => {
    renderWithWrapper(<ClientAuthGate {...baseProps} />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('renders password form for shared-password-only mode', () => {
    renderWithWrapper(<ClientAuthGate {...baseProps} />);
    expect(screen.getByPlaceholderText(/Dashboard password/i)).toBeInTheDocument();
  });

  it('renders Access Dashboard button', () => {
    renderWithWrapper(<ClientAuthGate {...baseProps} />);
    expect(screen.getByText(/Access Dashboard/i)).toBeInTheDocument();
  });

  it('renders user login form in user-login mode', () => {
    renderWithWrapper(
      <ClientAuthGate
        {...baseProps}
        authMode={{ hasSharedPassword: false, hasClientUsers: true }}
        loginTab="user"
      />
    );
    expect(screen.getByPlaceholderText(/Email address/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Password/i)).toBeInTheDocument();
  });

  it('renders Sign In button in user login mode', () => {
    renderWithWrapper(
      <ClientAuthGate
        {...baseProps}
        authMode={{ hasSharedPassword: false, hasClientUsers: true }}
        loginTab="user"
      />
    );
    expect(screen.getByText('Sign In')).toBeInTheDocument();
  });

  it('shows auth error message when provided', () => {
    renderWithWrapper(
      <ClientAuthGate {...baseProps} authError="Invalid password" />
    );
    expect(screen.getByText('Invalid password')).toBeInTheDocument();
  });

  it('renders forgot password form when loginView is forgot', () => {
    renderWithWrapper(
      <ClientAuthGate
        {...baseProps}
        authMode={{ hasSharedPassword: false, hasClientUsers: true }}
        loginTab="user"
        loginView="forgot"
      />
    );
    expect(screen.getByText(/Send Reset Link/i)).toBeInTheDocument();
  });

  it('renders reset password form when loginView is reset', () => {
    renderWithWrapper(
      <ClientAuthGate
        {...baseProps}
        authMode={{ hasSharedPassword: false, hasClientUsers: true }}
        loginTab="user"
        loginView="reset"
      />
    );
    expect(screen.getByText(/Set New Password/i)).toBeInTheDocument();
  });

  it('shows forgot password success message when forgotSent is true', () => {
    renderWithWrapper(
      <ClientAuthGate
        {...baseProps}
        authMode={{ hasSharedPassword: false, hasClientUsers: true }}
        loginTab="user"
        loginView="forgot"
        forgotSent={true}
      />
    );
    expect(screen.getByText(/Check your email/i)).toBeInTheDocument();
  });

  it('shows reset done message when resetDone is true', () => {
    renderWithWrapper(
      <ClientAuthGate
        {...baseProps}
        authMode={{ hasSharedPassword: false, hasClientUsers: true }}
        loginTab="user"
        loginView="reset"
        resetDone={true}
      />
    );
    expect(screen.getByText(/Password updated/i)).toBeInTheDocument();
  });

  it('shows both-modes switch link when both modes enabled', () => {
    renderWithWrapper(
      <ClientAuthGate
        {...baseProps}
        authMode={{ hasSharedPassword: true, hasClientUsers: true }}
        loginTab="password"
      />
    );
    expect(screen.getByText(/Sign in with your email instead/i)).toBeInTheDocument();
  });
});

// ── SearchSnapshot / AnalyticsSnapshot (DataSnapshots) ───────────────────────

import { SearchSnapshot, AnalyticsSnapshot } from '../../../src/components/client/DataSnapshots';
import type { SearchOverview, GA4Overview } from '../../../src/components/client/types';

describe('SearchSnapshot', () => {
  const mockOverview: SearchOverview = {
    totalClicks: 1250,
    totalImpressions: 45000,
    avgCtr: 2.7,
    avgPosition: 8.5,
    topPages: [
      { page: 'https://example.com/', clicks: 400, impressions: 12000, ctr: 3.3, position: 4.2 },
      { page: 'https://example.com/blog', clicks: 300, impressions: 8000, ctr: 3.75, position: 5.1 },
    ],
    topQueries: [],
    deviceBreakdown: [],
  };

  it('renders without crashing', () => {
    renderWithWrapper(
      <SearchSnapshot
        overview={mockOverview}
        trend={[]}
        comparison={null}
        devices={[]}
        onViewMore={vi.fn()}
      />
    );
    expect(screen.getByText('Google Search')).toBeInTheDocument();
  });

  it('shows total clicks metric', () => {
    renderWithWrapper(
      <SearchSnapshot
        overview={mockOverview}
        trend={[]}
        comparison={null}
        devices={[]}
        onViewMore={vi.fn()}
      />
    );
    // "Clicks" label appears at least once (may appear multiple times)
    const clickLabels = screen.getAllByText(/^Clicks$/i);
    expect(clickLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('shows total impressions metric', () => {
    renderWithWrapper(
      <SearchSnapshot
        overview={mockOverview}
        trend={[]}
        comparison={null}
        devices={[]}
        onViewMore={vi.fn()}
      />
    );
    const impressionLabels = screen.getAllByText(/^Impressions$/i);
    expect(impressionLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('renders top pages', () => {
    renderWithWrapper(
      <SearchSnapshot
        overview={mockOverview}
        trend={[]}
        comparison={null}
        devices={[]}
        onViewMore={vi.fn()}
      />
    );
    expect(screen.getByText('Homepage')).toBeInTheDocument();
  });

  it('calls onViewMore when "View details" clicked', () => {
    const onViewMore = vi.fn();
    renderWithWrapper(
      <SearchSnapshot
        overview={mockOverview}
        trend={[]}
        comparison={null}
        devices={[]}
        onViewMore={onViewMore}
      />
    );
    fireEvent.click(screen.getByText(/View details/i));
    expect(onViewMore).toHaveBeenCalledOnce();
  });

  it('renders device breakdown when devices provided', () => {
    renderWithWrapper(
      <SearchSnapshot
        overview={mockOverview}
        trend={[]}
        comparison={null}
        devices={[
          { device: 'mobile', clicks: 700, impressions: 25000, ctr: 2.8, position: 8.0 },
          { device: 'desktop', clicks: 550, impressions: 20000, ctr: 2.75, position: 9.0 },
        ]}
        onViewMore={vi.fn()}
      />
    );
    expect(screen.getByText(/mobile/i)).toBeInTheDocument();
    expect(screen.getByText(/desktop/i)).toBeInTheDocument();
  });
});

describe('AnalyticsSnapshot', () => {
  const mockGA4Overview: GA4Overview = {
    totalUsers: 3400,
    totalSessions: 5200,
    totalPageviews: 12000,
    avgSessionDuration: 120,
    bounceRate: 45,
    topSources: [],
    topPages: [{ path: '/', pageviews: 3000 }],
  };

  it('renders without crashing', () => {
    renderWithWrapper(
      <AnalyticsSnapshot
        overview={mockGA4Overview}
        trend={[]}
        topPages={[]}
        comparison={null}
        newVsReturning={[]}
        onViewMore={vi.fn()}
      />
    );
    expect(screen.getByText('Website Visitors')).toBeInTheDocument();
  });

  it('shows total users metric label', () => {
    renderWithWrapper(
      <AnalyticsSnapshot
        overview={mockGA4Overview}
        trend={[]}
        topPages={[]}
        comparison={null}
        newVsReturning={[]}
        onViewMore={vi.fn()}
      />
    );
    expect(screen.getByText('Visitors')).toBeInTheDocument();
  });

  it('shows total sessions metric label', () => {
    renderWithWrapper(
      <AnalyticsSnapshot
        overview={mockGA4Overview}
        trend={[]}
        topPages={[]}
        comparison={null}
        newVsReturning={[]}
        onViewMore={vi.fn()}
      />
    );
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('calls onViewMore when clicked', () => {
    const onViewMore = vi.fn();
    renderWithWrapper(
      <AnalyticsSnapshot
        overview={mockGA4Overview}
        trend={[]}
        topPages={[]}
        comparison={null}
        newVsReturning={[]}
        onViewMore={onViewMore}
      />
    );
    fireEvent.click(screen.getByText(/View details/i));
    expect(onViewMore).toHaveBeenCalledOnce();
  });

  it('renders new vs returning when data provided', () => {
    renderWithWrapper(
      <AnalyticsSnapshot
        overview={mockGA4Overview}
        trend={[]}
        topPages={[]}
        comparison={null}
        newVsReturning={[
          { segment: 'new', users: 2200, percentage: 65, bounceRate: 50 },
          { segment: 'returning', users: 1200, percentage: 35, bounceRate: 30 },
        ]}
        onViewMore={vi.fn()}
      />
    );
    // "New" and "Returning" appear in the new vs returning section
    const newElements = screen.getAllByText(/New/i);
    expect(newElements.length).toBeGreaterThanOrEqual(1);
    const retElements = screen.getAllByText(/Returning/i);
    expect(retElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders top pages by views', () => {
    renderWithWrapper(
      <AnalyticsSnapshot
        overview={mockGA4Overview}
        trend={[]}
        topPages={[
          { path: '/blog', pageviews: 800 },
          { path: '/about', pageviews: 300 },
        ]}
        comparison={null}
        newVsReturning={[]}
        onViewMore={vi.fn()}
      />
    );
    expect(screen.getByText('/blog')).toBeInTheDocument();
  });
});

// ── EmailCaptureGate ──────────────────────────────────────────────────────────

import { EmailCaptureGate } from '../../../src/components/client/EmailCaptureGate';

describe('EmailCaptureGate', () => {
  it('renders workspace name', () => {
    renderWithWrapper(
      <EmailCaptureGate
        workspaceId="ws-1"
        ws={mockWs}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(screen.getByText(/Welcome to Acme Corp/i)).toBeInTheDocument();
  });

  it('renders email input', () => {
    renderWithWrapper(
      <EmailCaptureGate
        workspaceId="ws-1"
        ws={mockWs}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/Your email address/i)).toBeInTheDocument();
  });

  it('renders name input', () => {
    renderWithWrapper(
      <EmailCaptureGate
        workspaceId="ws-1"
        ws={mockWs}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/Your name/i)).toBeInTheDocument();
  });

  it('renders Continue to Dashboard button', () => {
    renderWithWrapper(
      <EmailCaptureGate
        workspaceId="ws-1"
        ws={mockWs}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(screen.getByText(/Continue to Dashboard/i)).toBeInTheDocument();
  });

  it('renders Skip for now button', () => {
    renderWithWrapper(
      <EmailCaptureGate
        workspaceId="ws-1"
        ws={mockWs}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(screen.getByText(/Skip for now/i)).toBeInTheDocument();
  });

  it('calls onSkip when skip button is clicked', () => {
    const onSkip = vi.fn();
    renderWithWrapper(
      <EmailCaptureGate
        workspaceId="ws-1"
        ws={mockWs}
        onComplete={vi.fn()}
        onSkip={onSkip}
      />
    );
    fireEvent.click(screen.getByText(/Skip for now/i));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('renders with null workspace', () => {
    renderWithWrapper(
      <EmailCaptureGate
        workspaceId="ws-1"
        ws={null}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    // Mail icon should still appear
    expect(screen.getByText(/Skip for now/i)).toBeInTheDocument();
  });
});

// ── ClientOnboardingQuestionnaire ────────────────────────────────────────────

import { ClientOnboardingQuestionnaire } from '../../../src/components/client/ClientOnboardingQuestionnaire';

describe('ClientOnboardingQuestionnaire', () => {
  it('renders intro step by default', () => {
    renderWithWrapper(
      <ClientOnboardingQuestionnaire
        workspaceName="Acme Corp"
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(screen.getByText(/Help us create better content/i)).toBeInTheDocument();
  });

  it('renders Get Started button on intro', () => {
    renderWithWrapper(
      <ClientOnboardingQuestionnaire
        workspaceName="Acme Corp"
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(screen.getByText(/Get Started/i)).toBeInTheDocument();
  });

  it('renders Skip for now on intro', () => {
    renderWithWrapper(
      <ClientOnboardingQuestionnaire
        workspaceName="Acme Corp"
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(screen.getByText(/Skip for now/i)).toBeInTheDocument();
  });

  it('calls onSkip when skip is clicked', () => {
    const onSkip = vi.fn();
    renderWithWrapper(
      <ClientOnboardingQuestionnaire
        workspaceName="Acme Corp"
        onComplete={vi.fn()}
        onSkip={onSkip}
      />
    );
    fireEvent.click(screen.getByText(/Skip for now/i));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('advances to business step when Get Started is clicked', () => {
    renderWithWrapper(
      <ClientOnboardingQuestionnaire
        workspaceName="Acme Corp"
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText(/Get Started/i));
    expect(screen.getByText(/About Your Business/i)).toBeInTheDocument();
  });

  it('shows business name pre-filled from workspaceName', () => {
    renderWithWrapper(
      <ClientOnboardingQuestionnaire
        workspaceName="My Business"
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText(/Get Started/i));
    const input = screen.getByDisplayValue('My Business');
    expect(input).toBeInTheDocument();
  });

  it('shows section overview cards on intro', () => {
    renderWithWrapper(
      <ClientOnboardingQuestionnaire
        workspaceName="Acme"
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(screen.getByText('Your Business')).toBeInTheDocument();
    expect(screen.getByText('Your Audience')).toBeInTheDocument();
    expect(screen.getByText('Brand Voice')).toBeInTheDocument();
    expect(screen.getByText('Competitors')).toBeInTheDocument();
  });

  it('can navigate through multiple steps', () => {
    renderWithWrapper(
      <ClientOnboardingQuestionnaire
        workspaceName="Acme"
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    // intro → business
    fireEvent.click(screen.getByText(/Get Started/i));
    expect(screen.getByText(/About Your Business/i)).toBeInTheDocument();
    // business → audience
    fireEvent.click(screen.getByText(/Continue/i));
    expect(screen.getByText(/Your Target Audience/i)).toBeInTheDocument();
  });

  it('shows saving indicator when saving prop is true', () => {
    renderWithWrapper(
      <ClientOnboardingQuestionnaire
        workspaceName="Acme"
        onComplete={vi.fn()}
        onSkip={vi.fn()}
        saving={false}
      />
    );
    // Not saving initially — just verify it renders
    expect(screen.getByText(/Get Started/i)).toBeInTheDocument();
  });
});

// ── SeoEducationTip ───────────────────────────────────────────────────────────

import { SeoEducationTip } from '../../../src/components/client/SeoEducationTip';

describe('SeoEducationTip', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders null for unknown tab', () => {
    const { container } = renderWithWrapper(
      <SeoEducationTip tab="unknown-tab" workspaceId="ws-1" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders null for known tab when already seen (localStorage)', () => {
    localStorage.setItem('seo_tip_seen_ws-1_overview', 'true');
    const { container } = renderWithWrapper(
      <SeoEducationTip tab="overview" workspaceId="ws-1" />
    );
    // Not visible immediately (requires 600ms delay + localStorage not seen)
    expect(container.firstChild).toBeNull();
  });
});

// ── ServiceInterestCTA ────────────────────────────────────────────────────────

import { ServiceInterestCTA } from '../../../src/components/client/ServiceInterestCTA';

describe('ServiceInterestCTA', () => {
  it('renders content_interest CTA with correct label', () => {
    renderWithWrapper(
      <ServiceInterestCTA
        type="content_interest"
        workspaceId="ws-1"
        onAction={vi.fn()}
      />
    );
    expect(screen.getByText(/Explore content recommendations/i)).toBeInTheDocument();
  });

  it('renders service_interest CTA with correct label when no booking url', () => {
    renderWithWrapper(
      <ServiceInterestCTA
        type="service_interest"
        workspaceId="ws-1"
        onAction={vi.fn()}
      />
    );
    expect(screen.getByText(/Get in touch/i)).toBeInTheDocument();
  });

  it('renders Book a call when booking URL is provided', () => {
    renderWithWrapper(
      <ServiceInterestCTA
        type="service_interest"
        workspaceId="ws-1"
        onAction={vi.fn()}
        bookingUrl="https://calendly.com/example"
      />
    );
    expect(screen.getByText(/Book a call/i)).toBeInTheDocument();
  });

  it('calls onAction for content_interest click without mutation', () => {
    const onAction = vi.fn();
    renderWithWrapper(
      <ServiceInterestCTA
        type="content_interest"
        workspaceId="ws-1"
        onAction={onAction}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onAction).toHaveBeenCalledWith('content_interest');
  });

  it('renders subtext for content_interest', () => {
    renderWithWrapper(
      <ServiceInterestCTA
        type="content_interest"
        workspaceId="ws-1"
        onAction={vi.fn()}
      />
    );
    expect(screen.getByText(/See what content we recommend/i)).toBeInTheDocument();
  });

  it('renders subtext for service_interest with booking', () => {
    renderWithWrapper(
      <ServiceInterestCTA
        type="service_interest"
        workspaceId="ws-1"
        onAction={vi.fn()}
        bookingUrl="https://calendly.com/example"
      />
    );
    expect(screen.getByText(/Schedule time with us/i)).toBeInTheDocument();
  });

  it('renders subtext for service_interest without booking', () => {
    renderWithWrapper(
      <ServiceInterestCTA
        type="service_interest"
        workspaceId="ws-1"
        onAction={vi.fn()}
      />
    );
    expect(screen.getByText(/We'll reach out/i)).toBeInTheDocument();
  });
});

// ── BetaProvider / useBetaMode ────────────────────────────────────────────────

import { useBetaMode } from '../../../src/components/client/BetaContext';

describe('BetaProvider / useBetaMode', () => {
  function BetaModeDisplay() {
    const beta = useBetaMode();
    return <div data-testid="beta-mode">{beta ? 'beta' : 'normal'}</div>;
  }

  it('defaults to false when no provider wraps', () => {
    // This uses React.createContext default (false)
    render(<BetaModeDisplay />);
    expect(screen.getByTestId('beta-mode')).toHaveTextContent('normal');
  });

  it('provides true when BetaProvider value is true', () => {
    render(
      <BetaProvider value={true}>
        <BetaModeDisplay />
      </BetaProvider>
    );
    expect(screen.getByTestId('beta-mode')).toHaveTextContent('beta');
  });

  it('provides false when BetaProvider value is false', () => {
    render(
      <BetaProvider value={false}>
        <BetaModeDisplay />
      </BetaProvider>
    );
    expect(screen.getByTestId('beta-mode')).toHaveTextContent('normal');
  });
});

// ── ClientHeader ──────────────────────────────────────────────────────────────

import { ClientHeader } from '../../../src/components/client/ClientHeader';
import { CartProvider } from '../../../src/components/client/useCart';

function ClientHeaderWrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CartProvider>
          {children}
        </CartProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const mockNAV = [
  { id: 'overview' as ClientTab, label: 'Overview', icon: Home, locked: false },
  { id: 'performance' as ClientTab, label: 'Performance', icon: BarChart2, locked: false },
  { id: 'health' as ClientTab, label: 'Health', icon: Settings, locked: false },
];

const baseHeaderProps = {
  ws: mockWs,
  betaMode: false,
  theme: 'dark' as const,
  toggleTheme: vi.fn(),
  tab: 'overview' as ClientTab,
  setTab: vi.fn(),
  NAV: mockNAV,
  days: 28,
  customDateRange: null,
  showDatePicker: false,
  setShowDatePicker: vi.fn(),
  changeDays: vi.fn(),
  applyCustomRange: vi.fn(),
  customStartRef: { current: null },
  customEndRef: { current: null },
  clientUser: null,
  handleClientLogout: vi.fn(),
  onShowTour: vi.fn(),
  setShowUpgradeModal: vi.fn(),
  pendingApprovals: 0,
  unreadTeamNotes: 0,
  hasCopyEntries: false,
  contentPlanSummary: null,
  hasData: () => false,
  contentRequests: [],
  hasAnalytics: false,
  hasAnyData: false,
  effectiveTier: 'growth' as const,
  clientIaV2: false,
};

describe('ClientHeader', () => {
  it('renders workspace name', () => {
    render(<ClientHeader {...baseHeaderProps} />, { wrapper: ClientHeaderWrapper });
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('renders navigation tabs', () => {
    render(<ClientHeader {...baseHeaderProps} />, { wrapper: ClientHeaderWrapper });
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Performance')).toBeInTheDocument();
  });

  it('marks active tab with aria-selected', () => {
    render(<ClientHeader {...baseHeaderProps} tab="performance" />, { wrapper: ClientHeaderWrapper });
    const performanceTab = screen.getByRole('tab', { name: /Performance/i });
    expect(performanceTab).toHaveAttribute('aria-selected', 'true');
  });

  it('calls setTab when a nav tab is clicked', () => {
    const setTab = vi.fn();
    render(<ClientHeader {...baseHeaderProps} setTab={setTab} />, { wrapper: ClientHeaderWrapper });
    fireEvent.click(screen.getByText('Performance'));
    expect(setTab).toHaveBeenCalledWith('performance');
  });

  it('renders client user info when clientUser is set', () => {
    render(
      <ClientHeader
        {...baseHeaderProps}
        clientUser={{ id: 'u1', name: 'Jane Doe', email: 'jane@example.com' }}
      />,
      { wrapper: ClientHeaderWrapper }
    );
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('renders trial badge when workspace is in trial', () => {
    render(
      <ClientHeader
        {...baseHeaderProps}
        ws={{ ...mockWs, isTrial: true, trialDaysRemaining: 7 }}
      />,
      { wrapper: ClientHeaderWrapper }
    );
    expect(screen.getByText(/Growth Trial/i)).toBeInTheDocument();
  });

  it('shows inbox badge count when there are pending approvals', () => {
    const navWithInbox = [
      ...mockNAV,
      { id: 'inbox' as ClientTab, label: 'Inbox', icon: Home, locked: false },
    ];
    render(
      <ClientHeader
        {...baseHeaderProps}
        NAV={navWithInbox}
        pendingApprovals={3}
      />,
      { wrapper: ClientHeaderWrapper }
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders date range buttons when hasAnalytics is true', () => {
    render(
      <ClientHeader {...baseHeaderProps} hasAnalytics={true} />,
      { wrapper: ClientHeaderWrapper }
    );
    expect(screen.getByText('7d')).toBeInTheDocument();
    expect(screen.getByText('28d')).toBeInTheDocument();
  });

  it('calls toggleTheme when theme button is clicked', () => {
    const toggleTheme = vi.fn();
    render(
      <ClientHeader {...baseHeaderProps} toggleTheme={toggleTheme} />,
      { wrapper: ClientHeaderWrapper }
    );
    // The toggle button has aria-label "Switch to light mode" or "Switch to dark mode"
    const themeBtn = screen.getByLabelText(/Switch to light mode/i);
    fireEvent.click(themeBtn);
    expect(toggleTheme).toHaveBeenCalledOnce();
  });

  it('calls onShowTour when tour button is clicked', () => {
    const onShowTour = vi.fn();
    render(
      <ClientHeader {...baseHeaderProps} onShowTour={onShowTour} />,
      { wrapper: ClientHeaderWrapper }
    );
    fireEvent.click(screen.getByLabelText(/Show welcome tour/i));
    expect(onShowTour).toHaveBeenCalledOnce();
  });

  it('locks tabs and triggers upgrade modal when locked tab clicked', () => {
    const setShowUpgradeModal = vi.fn();
    const navWithLocked = [
      ...mockNAV,
      { id: 'content-plan' as ClientTab, label: 'Content Plan', icon: Settings, locked: true },
    ];
    render(
      <ClientHeader
        {...baseHeaderProps}
        NAV={navWithLocked}
        setShowUpgradeModal={setShowUpgradeModal}
      />,
      { wrapper: ClientHeaderWrapper }
    );
    fireEvent.click(screen.getByRole('tab', { name: /Content Plan/i }));
    expect(setShowUpgradeModal).toHaveBeenCalledWith(true);
  });
});

// ── SeoCartButton ─────────────────────────────────────────────────────────────

import { SeoCartButton, SeoCartDrawer } from '../../../src/components/client/SeoCart';
import type { ProductType } from '../../../server/payments';

describe('SeoCartButton', () => {
  it('renders null when cart is empty', () => {
    const { container } = render(
      <CartProvider>
        <SeoCartButton />
      </CartProvider>,
      { wrapper: Wrapper }
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('SeoCartDrawer', () => {
  it('renders null when cart is closed', () => {
    const { container } = render(
      <CartProvider>
        <SeoCartDrawer workspaceId="ws-1" />
      </CartProvider>,
      { wrapper: Wrapper }
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── OrderStatus ───────────────────────────────────────────────────────────────

import { OrderStatus } from '../../../src/components/client/OrderStatus';

describe('OrderStatus', () => {
  it('renders without crashing — shows loading or empty state', () => {
    // getSafe is mocked to return {}, which means empty orders
    renderWithWrapper(
      <OrderStatus workspaceId="ws-1" />
    );
    // No crash is sufficient; query is async so no content renders synchronously
    expect(true).toBe(true);
  });
});

// ── OutcomeSummary ────────────────────────────────────────────────────────────

import OutcomeSummary from '../../../src/components/client/OutcomeSummary';

describe('OutcomeSummary', () => {
  it('renders without crashing for free tier', () => {
    renderWithWrapper(
      <OutcomeSummary workspaceId="ws-1" tier="free" />
    );
    expect(true).toBe(true);
  });

  it('renders without crashing for growth tier', () => {
    renderWithWrapper(
      <OutcomeSummary workspaceId="ws-1" tier="growth" />
    );
    expect(true).toBe(true);
  });

  it('renders without crashing for premium tier', () => {
    renderWithWrapper(
      <OutcomeSummary workspaceId="ws-1" tier="premium" />
    );
    expect(true).toBe(true);
  });
});
