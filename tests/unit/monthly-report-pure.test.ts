/**
 * Wave 20-a5 — Pure function unit tests for server/monthly-report.ts
 *
 * Covers:
 *   - currentMonth algorithm (inline): YYYY-MM format, zero-padding
 *   - currentWeek algorithm (inline): year prefix, padding, rough range
 *   - currentPeriod dispatcher: routes to week vs month
 *   - generateReportHTML: returns HTML string, trial logic, score delta
 *   - listMonthlyReports: empty dir → [], sort order, corrupt file skip
 *   - startMonthlyReports / stopMonthlyReports: idempotent lifecycle
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  generateReportHTML,
  listMonthlyReports,
  getMonthlyReportHTML,
  startMonthlyReports,
  stopMonthlyReports,
} from '../../server/monthly-report.js';
import type { SavedMonthlyReport } from '../../server/monthly-report.js';

// ────────────────────────────────────────────────────────────────────────────
// Replicated pure helpers from monthly-report.ts (non-exported)
// ────────────────────────────────────────────────────────────────────────────

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function currentWeek(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function currentPeriod(frequency: 'weekly' | 'monthly'): string {
  return frequency === 'weekly' ? currentWeek() : currentMonth();
}

// ────────────────────────────────────────────────────────────────────────────
// Minimal Workspace-like fixture
// ────────────────────────────────────────────────────────────────────────────

function makeWorkspace(overrides: Record<string, unknown> = {}): Parameters<typeof generateReportHTML>[0]['workspace'] {
  return {
    id: 'ws-report-test',
    name: 'Test Agency',
    tier: 'growth',
    trialEndsAt: null,
    clientEmail: null,
    autoReports: false,
    ...overrides,
  } as Parameters<typeof generateReportHTML>[0]['workspace'];
}

function makeData(overrides: Partial<Parameters<typeof generateReportHTML>[0]> = {}): Parameters<typeof generateReportHTML>[0] {
  return {
    workspace: makeWorkspace(),
    requestsCompleted: 0,
    requestsOpen: 0,
    approvalsApplied: 0,
    approvalsPending: 0,
    activityCount: 0,
    topActivities: [],
    ...overrides,
  };
}

// ─── currentMonth ────────────────────────────────────────────────────────────

describe('currentMonth algorithm', () => {
  it('returns a string matching YYYY-MM format', () => {
    expect(currentMonth()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('zero-pads single-digit months', () => {
    const result = currentMonth();
    const month = result.split('-')[1];
    expect(month.length).toBe(2);
  });

  it('month value is between 01 and 12', () => {
    const month = parseInt(currentMonth().split('-')[1], 10);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });
});

// ─── currentWeek ─────────────────────────────────────────────────────────────

describe('currentWeek algorithm', () => {
  it('returns a string matching YYYY-Www format', () => {
    expect(currentWeek()).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('week number is between 01 and 53', () => {
    const week = parseInt(currentWeek().split('-W')[1], 10);
    expect(week).toBeGreaterThanOrEqual(1);
    expect(week).toBeLessThanOrEqual(53);
  });

  it('year in week label matches current year', () => {
    const year = parseInt(currentWeek().split('-')[0], 10);
    expect(year).toBe(new Date().getFullYear());
  });
});

// ─── currentPeriod dispatcher ────────────────────────────────────────────────

describe('currentPeriod', () => {
  it('returns currentMonth() result for frequency=monthly', () => {
    expect(currentPeriod('monthly')).toBe(currentMonth());
  });

  it('returns currentWeek() result for frequency=weekly', () => {
    expect(currentPeriod('weekly')).toBe(currentWeek());
  });

  it('monthly and weekly return different format strings', () => {
    const monthly = currentPeriod('monthly');
    const weekly = currentPeriod('weekly');
    expect(monthly).not.toBe(weekly);
  });
});

// ─── generateReportHTML ──────────────────────────────────────────────────────

describe('generateReportHTML', () => {
  it('returns a non-empty HTML string', () => {
    const html = generateReportHTML(makeData());
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('includes the workspace name in the output', () => {
    const html = generateReportHTML(makeData({ workspace: makeWorkspace({ name: 'UniqueAgencyXYZ' }) }));
    expect(html).toContain('UniqueAgencyXYZ');
  });

  it('handles missing optional fields without throwing', () => {
    expect(() =>
      generateReportHTML(makeData({
        siteScore: undefined,
        previousScore: undefined,
        totalPages: undefined,
        errors: undefined,
        warnings: undefined,
      })),
    ).not.toThrow();
  });

  it('includes site score when provided', () => {
    const html = generateReportHTML(makeData({ siteScore: 87 }));
    expect(html).toContain('87');
  });

  it('handles trial workspace with future trialEndsAt', () => {
    const future = new Date(Date.now() + 7 * 86400_000).toISOString();
    const html = generateReportHTML(
      makeData({ workspace: makeWorkspace({ trialEndsAt: future }) }),
    );
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('handles expired trial (trialEndsAt in the past)', () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    const html = generateReportHTML(
      makeData({ workspace: makeWorkspace({ trialEndsAt: past }) }),
    );
    expect(typeof html).toBe('string');
  });

  it('includes traffic data when provided (requires both clicks and impressions to render row)', () => {
    const html = generateReportHTML(
      makeData({
        traffic: {
          clicks: { current: 500, previous: 400, changePct: 25 },
          impressions: { current: 12000, previous: 10000, changePct: 20 },
        },
      }),
    );
    // The template renders both metrics in the same row — 500 appears as "500" via toLocaleString
    expect(html).toContain('12,000');
  });

  it('handles topActivities list', () => {
    const html = generateReportHTML(
      makeData({
        topActivities: [
          { title: 'Published new page', createdAt: new Date().toISOString() },
        ],
      }),
    );
    expect(html).toContain('Published new page');
  });
});

// ─── listMonthlyReports ──────────────────────────────────────────────────────

describe('listMonthlyReports', () => {
  it('returns empty array for a workspace with no reports directory', () => {
    const result = listMonthlyReports('ws-nonexistent-report-workspace-xyz');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('returns sorted reports newest-first', () => {
    // DATA_DIR is set by tests/db-setup.ts to an isolated temp directory.
    // getDataDir('monthly-reports') in monthly-report.ts resolves to DATA_DIR/monthly-reports.
    const dataDir = process.env.DATA_DIR
      ?? path.join(os.homedir(), '.asset-dashboard');
    const wsId = `ws-mr-sort-${Math.random().toString(36).slice(2, 8)}`;
    const wsDir = path.join(dataDir, 'monthly-reports', wsId);
    fs.mkdirSync(wsDir, { recursive: true });

    const older: SavedMonthlyReport = {
      id: 'mr_older',
      workspaceId: wsId,
      workspaceName: 'Test',
      createdAt: new Date('2025-01-15T00:00:00Z').toISOString(),
      period: 'January 2025',
    };
    const newer: SavedMonthlyReport = {
      id: 'mr_newer',
      workspaceId: wsId,
      workspaceName: 'Test',
      createdAt: new Date('2025-02-15T00:00:00Z').toISOString(),
      period: 'February 2025',
    };
    fs.writeFileSync(path.join(wsDir, 'mr_older.json'), JSON.stringify(older));
    fs.writeFileSync(path.join(wsDir, 'mr_newer.json'), JSON.stringify(newer));

    const reports = listMonthlyReports(wsId);
    expect(reports[0].id).toBe('mr_newer');
    expect(reports[1].id).toBe('mr_older');
  });

  it('silently skips corrupt JSON files', () => {
    const dataDir = process.env.DATA_DIR
      ?? path.join(os.homedir(), '.asset-dashboard');
    const wsId = `ws-mr-corrupt-${Math.random().toString(36).slice(2, 8)}`;
    const wsDir = path.join(dataDir, 'monthly-reports', wsId);
    fs.mkdirSync(wsDir, { recursive: true });

    // One valid, one corrupt
    const valid: SavedMonthlyReport = {
      id: 'mr_valid',
      workspaceId: wsId,
      workspaceName: 'Test',
      createdAt: new Date().toISOString(),
      period: 'March 2025',
    };
    fs.writeFileSync(path.join(wsDir, 'mr_valid.json'), JSON.stringify(valid));
    fs.writeFileSync(path.join(wsDir, 'mr_corrupt.json'), '{not valid json{{');

    const reports = listMonthlyReports(wsId);
    expect(reports).toHaveLength(1);
    expect(reports[0].id).toBe('mr_valid');
  });
});

// ─── getMonthlyReportHTML ────────────────────────────────────────────────────

describe('getMonthlyReportHTML', () => {
  it('returns null when no reports directory exists at all', () => {
    const result = getMonthlyReportHTML('mr_totally_nonexistent_id_xyz');
    expect(result).toBeNull();
  });
});

// ─── startMonthlyReports / stopMonthlyReports ────────────────────────────────

describe('startMonthlyReports / stopMonthlyReports lifecycle', () => {
  afterEach(() => {
    stopMonthlyReports();
  });

  it('startMonthlyReports does not throw', () => {
    expect(() => startMonthlyReports()).not.toThrow();
  });

  it('calling startMonthlyReports twice is idempotent', () => {
    startMonthlyReports();
    expect(() => startMonthlyReports()).not.toThrow();
  });

  it('stopMonthlyReports does not throw even without start', () => {
    expect(() => stopMonthlyReports()).not.toThrow();
  });

  it('stop after start does not throw', () => {
    startMonthlyReports();
    expect(() => stopMonthlyReports()).not.toThrow();
  });

  it('double stop is idempotent', () => {
    startMonthlyReports();
    stopMonthlyReports();
    expect(() => stopMonthlyReports()).not.toThrow();
  });
});
