import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockedReports = vi.hoisted(() => ({
  listSnapshots: vi.fn(),
  listSnapshotsDetailed: vi.fn(),
  getSnapshot: vi.fn(),
  getLatestSnapshot: vi.fn(),
  getLatestSnapshotBefore: vi.fn(),
}));

vi.mock('../../server/reports.js', () => ({
  listSnapshots: mockedReports.listSnapshots,
  listSnapshotsDetailed: mockedReports.listSnapshotsDetailed,
  getSnapshot: mockedReports.getSnapshot,
  getLatestSnapshot: mockedReports.getLatestSnapshot,
  getLatestSnapshotBefore: mockedReports.getLatestSnapshotBefore,
}));

import { listEffectiveSnapshotSummaries } from '../../server/audit-snapshot-views.js';

describe('audit-snapshot-views', () => {
  beforeEach(() => {
    mockedReports.listSnapshots.mockReset();
    mockedReports.listSnapshotsDetailed.mockReset();
    mockedReports.getSnapshot.mockReset();
    mockedReports.getLatestSnapshot.mockReset();
    mockedReports.getLatestSnapshotBefore.mockReset();
  });

  it('returns raw summaries and skips detailed snapshot reads when suppressions are absent', () => {
    const summaries = [{
      id: 's1',
      createdAt: '2026-05-18T00:00:00.000Z',
      siteScore: 88,
      previousScore: 80,
      totalPages: 1,
      errors: 0,
      warnings: 1,
      infos: 0,
    }];
    mockedReports.listSnapshots.mockReturnValue(summaries);

    const result = listEffectiveSnapshotSummaries('site-1', []);

    expect(result).toEqual(summaries);
    expect(mockedReports.listSnapshots).toHaveBeenCalledWith('site-1');
    expect(mockedReports.listSnapshotsDetailed).not.toHaveBeenCalled();
  });

  it('uses ordered detailed snapshots to compute suppression-adjusted current and previous scores', () => {
    mockedReports.listSnapshotsDetailed.mockReturnValue([
      {
        id: 'current',
        siteId: 'site-1',
        siteName: 'Example',
        createdAt: '2026-05-18T10:00:00.000Z',
        previousScore: 70,
        audit: {
          siteScore: 85,
          totalPages: 1,
          errors: 1,
          warnings: 0,
          infos: 0,
          pages: [{
            pageId: 'p-about',
            slug: 'about',
            url: 'https://example.com/about',
            page: 'About',
            score: 85,
            issues: [
              { check: 'meta-description', severity: 'error', message: 'Suppressed', recommendation: 'Fix meta' },
            ],
          }],
          siteWideIssues: [],
        },
      },
      {
        id: 'previous',
        siteId: 'site-1',
        siteName: 'Example',
        createdAt: '2026-05-17T10:00:00.000Z',
        previousScore: undefined,
        audit: {
          siteScore: 70,
          totalPages: 1,
          errors: 1,
          warnings: 1,
          infos: 0,
          pages: [{
            pageId: 'p-about',
            slug: 'about',
            url: 'https://example.com/about',
            page: 'About',
            score: 70,
            issues: [
              { check: 'meta-description', severity: 'error', message: 'Suppressed', recommendation: 'Fix meta' },
              { check: 'content-length', severity: 'warning', message: 'Visible', recommendation: 'Expand content' },
            ],
          }],
          siteWideIssues: [],
        },
      },
    ]);

    const result = listEffectiveSnapshotSummaries('site-1', [
      { check: 'meta-description', pageSlug: 'about', createdAt: '2026-05-18T00:00:00.000Z' },
    ]);

    expect(mockedReports.listSnapshotsDetailed).toHaveBeenCalledWith('site-1');
    expect(mockedReports.listSnapshots).not.toHaveBeenCalled();
    expect(result[0]).toEqual(expect.objectContaining({
      id: 'current',
      siteScore: 100,
      previousScore: 97,
      errors: 0,
      warnings: 0,
    }));
    expect(result[1]).toEqual(expect.objectContaining({
      id: 'previous',
      siteScore: 97,
      errors: 0,
      warnings: 1,
    }));
  });
});
