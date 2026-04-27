import { describe, it, expect } from 'vitest';
import { statusConfig, statusBorderClass, statusDotClass } from '../../src/components/ui/statusConfig';
import type { PageEditStatus } from '../../src/components/ui/statusConfig';

describe('statusConfig', () => {
  it('has null for clean status', () => {
    expect(statusConfig.clean).toBeNull();
  });

  it('has config for all non-clean statuses', () => {
    const statuses: PageEditStatus[] = ['issue-detected', 'fix-proposed', 'in-review', 'approved', 'rejected', 'live'];
    for (const status of statuses) {
      const config = statusConfig[status];
      expect(config).not.toBeNull();
      expect(config!.label).toBeTruthy();
      expect(config!.border).toBeTruthy();
      expect(config!.bg).toBeTruthy();
      expect(config!.text).toBeTruthy();
      expect(config!.dot).toBeTruthy();
    }
  });

  it('has correct labels', () => {
    expect(statusConfig['issue-detected']!.label).toBe('Issue Detected');
    expect(statusConfig['fix-proposed']!.label).toBe('Fix Proposed');
    expect(statusConfig['in-review']!.label).toBe('In Review');
    expect(statusConfig.approved!.label).toBe('Approved');
    expect(statusConfig.rejected!.label).toBe('Rejected');
    expect(statusConfig.live!.label).toBe('Live');
  });

  it('uses distinct color families per status', () => {
    expect(statusConfig['issue-detected']!.text).toContain('amber');
    expect(statusConfig['fix-proposed']!.text).toContain('blue');
    // in-review uses teal to stay visually distinct from fix-proposed (blue).
    // Overlap with live (also teal) is acceptable — they are non-adjacent states.
    expect(statusConfig['in-review']!.text).toContain('teal');
    // approved uses emerald (refined from green) per visual polish spec
    expect(statusConfig.approved!.text).toContain('emerald');
    expect(statusConfig.rejected!.text).toContain('red');
    expect(statusConfig.live!.text).toContain('teal');
  });

  it('fix-proposed and in-review have distinct color families', () => {
    // Guards against the regression fixed in PR #280 where both shared identical blue,
    // collapsing the visual distinction in status summary bars.
    const fixProposed = statusConfig['fix-proposed']!;
    const inReview = statusConfig['in-review']!;
    expect(fixProposed.text).not.toBe(inReview.text);
    expect(fixProposed.border).not.toBe(inReview.border);
    expect(fixProposed.bg).not.toBe(inReview.bg);
    expect(fixProposed.dot).not.toBe(inReview.dot);
  });
});

describe('statusBorderClass', () => {
  it('returns empty string for clean status', () => {
    expect(statusBorderClass('clean')).toBe('');
  });

  it('returns empty string for null', () => {
    expect(statusBorderClass(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(statusBorderClass(undefined)).toBe('');
  });

  it('returns border class for non-clean statuses', () => {
    const result = statusBorderClass('approved');
    expect(result).toContain('border-l-2');
    // approved uses emerald border per visual polish spec
    expect(result).toContain('border-emerald-500');
  });

  it('adjusts opacity from /30 to /40', () => {
    const result = statusBorderClass('rejected');
    expect(result).toContain('/40');
  });
});

describe('statusDotClass', () => {
  it('returns empty string for clean status', () => {
    expect(statusDotClass('clean')).toBe('');
  });

  it('returns empty string for null', () => {
    expect(statusDotClass(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(statusDotClass(undefined)).toBe('');
  });

  it('returns dot class for non-clean statuses', () => {
    // approved uses emerald/80 per visual polish spec
    expect(statusDotClass('approved')).toContain('bg-emerald-400');
    // rejected and red are muted with /80 opacity
    expect(statusDotClass('rejected')).toContain('bg-red-400');
    expect(statusDotClass('live')).toContain('bg-teal-400');
  });
});
