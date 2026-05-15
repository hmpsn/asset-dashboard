import { describe, expect, it } from 'vitest';

import {
  buildReleaseSafetyChecklist,
  buildReleaseSafetyReport,
  collectReleaseSafetyDeployNotes,
  formatReleaseSafetyReportMarkdown,
  summarizeRoadmapNote,
  type BuildReleaseSafetyOptions,
} from '../../scripts/platform-release-safety.js';
import type { RoadmapData } from '../../shared/types/roadmap.js';

const roadmapFixture: RoadmapData = {
  sprints: [
    {
      id: 'sprint-alpha',
      name: 'Alpha Sprint',
      items: [
        {
          id: 'alpha-done',
          title: 'Alpha shipped item',
          status: 'done',
          shippedAt: '2026-05-14',
          priority: 'P1',
          notes: 'Shipped 2026-05-14: Added alpha delivery path. Includes fallback guardrails.',
        },
        {
          id: 'alpha-pending',
          title: 'Alpha pending item',
          status: 'pending',
          notes: 'Not shipped yet',
        },
      ],
    },
    {
      id: 'sprint-beta',
      name: 'Beta Sprint',
      items: [
        {
          id: 'beta-done',
          title: 'Beta shipped item',
          status: 'done',
          shippedAt: '2026-05-10',
          priority: 'P3',
          notes: 'Shipped 2026-05-10: Added beta smoke checks.',
        },
      ],
    },
  ],
};

const baseOptions: BuildReleaseSafetyOptions = {
  since: '2026-05-12',
  until: '2026-05-15',
  days: 3,
};

describe('platform release safety report', () => {
  it('summarizes shipped notes to a concise sentence', () => {
    const summary = summarizeRoadmapNote('Shipped 2026-05-14: Added release checklist. Added rollout notes too.');
    expect(summary).toBe('Added release checklist.');
  });

  it('collects shipped roadmap notes in-window only', () => {
    const notes = collectReleaseSafetyDeployNotes(roadmapFixture, baseOptions);

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      sprintId: 'sprint-alpha',
      itemId: 'alpha-done',
      shippedAt: '2026-05-14',
      title: 'Alpha shipped item',
    });
  });

  it('applies sprint filtering when requested', () => {
    const notes = collectReleaseSafetyDeployNotes(roadmapFixture, {
      ...baseOptions,
      since: '2026-05-01',
      until: '2026-05-31',
      days: 30,
      sprintFilter: 'sprint-beta',
    });

    expect(notes).toHaveLength(1);
    expect(notes[0]?.sprintId).toBe('sprint-beta');
    expect(notes[0]?.itemId).toBe('beta-done');
  });

  it('builds report with all checklist sections', () => {
    const report = buildReleaseSafetyReport(roadmapFixture, baseOptions);
    const checklist = buildReleaseSafetyChecklist();

    expect(report.generatedBy).toBe('scripts/platform-release-safety.ts');
    expect(report.window.since).toBe('2026-05-12');
    expect(report.deployNotes.length).toBe(1);

    expect(checklist.featureClassReleaseChecklist.length).toBeGreaterThan(0);
    expect(checklist.stagingSmokeSuite.length).toBeGreaterThan(0);
    expect(checklist.rollbackChecklist.length).toBeGreaterThan(0);
    expect(checklist.featureFlagRolloutChecklist.length).toBeGreaterThan(0);
    expect(checklist.postReleaseMonitoringWindow.length).toBeGreaterThan(0);
  });

  it('formats markdown with deploy notes and checklist sections', () => {
    const report = buildReleaseSafetyReport(roadmapFixture, baseOptions);
    const markdown = formatReleaseSafetyReportMarkdown(report);

    expect(markdown).toContain('# Release Safety Report');
    expect(markdown).toContain('## Deploy Notes (Roadmap-derived)');
    expect(markdown).toContain('Alpha shipped item');
    expect(markdown).toContain('## Feature-Class Release Checklist');
    expect(markdown).toContain('## Staging Smoke Suite');
    expect(markdown).toContain('## Rollback Checklist');
    expect(markdown).toContain('## Feature-Flag Rollout Checklist');
    expect(markdown).toContain('## Post-Release Monitoring Window');
  });
});
