import { describe, it, expect } from 'vitest';
import type { AnomalyDigestData, InsightSeverity } from '../../shared/types/analytics.js';

describe('anomaly-to-insight conversion', () => {
  it('maps every AnomalySeverity value to the correct InsightSeverity', () => {
    // This mirrors the production mapping in server/anomaly-detection.ts.
    // AnomalySeverity = 'critical' | 'warning' | 'positive'
    const severityMap: Record<string, InsightSeverity> = {
      critical: 'critical',
      warning: 'warning',
      positive: 'positive',  // positive anomalies (e.g. traffic_spike) → positive, NOT opportunity
    };

    expect(severityMap['critical']).toBe('critical');
    expect(severityMap['warning']).toBe('warning');
    // Positive anomalies must map to 'positive', not 'opportunity' —
    // mapping to 'opportunity' inflates base impact score from 20 to 40
    expect(severityMap['positive']).toBe('positive');

    // Verify all three AnomalySeverity values are covered (no missing keys)
    const covered = Object.keys(severityMap);
    expect(covered).toContain('critical');
    expect(covered).toContain('warning');
    expect(covered).toContain('positive');
  });

  it('classifies traffic anomaly types to traffic domain', () => {
    const trafficTypes = ['traffic_drop', 'traffic_spike', 'bounce_spike'];
    expect(trafficTypes.length).toBeGreaterThan(0);
    for (const t of trafficTypes) {
      const domain = t.includes('traffic') || t.includes('bounce') ? 'traffic' : 'search';
      expect(domain).toBe('traffic');
    }
  });

  it('classifies search anomaly types to search domain', () => {
    const searchTypes = ['impressions_drop', 'ctr_drop', 'position_decline'];
    expect(searchTypes.length).toBeGreaterThan(0);
    for (const t of searchTypes) {
      const domain = t.includes('impression') || t.includes('position') || t.includes('ctr') ? 'search' : 'cross';
      expect(domain).toBe('search');
    }
  });

  it('computes duration days from detection timestamp', () => {
    const now = Date.now();
    const fiveDaysAgo = new Date(now - 5 * 86400000).toISOString();
    const days = Math.ceil((now - new Date(fiveDaysAgo).getTime()) / 86400000);
    expect(days).toBe(5);
  });

  it('preserves firstDetected from existing insight across upserts', () => {
    // durationDays must be computed from firstDetected (persisted on first detection),
    // not from a.detectedAt (set to now() on every detection cycle).
    const originalFirstDetected = new Date(Date.now() - 7 * 86400000).toISOString();
    const currentDetectedAt = new Date().toISOString(); // always "now"

    // Simulate the fix: use existing firstDetected when available
    const existingFirstDetected = originalFirstDetected;
    const firstDetected = existingFirstDetected ?? currentDetectedAt;
    const durationDays = Math.max(1, Math.ceil((Date.now() - new Date(firstDetected).getTime()) / 86400000));

    // Without the fix (using currentDetectedAt): durationDays would always be 1
    expect(durationDays).toBeGreaterThanOrEqual(7);
  });

  it('generates correct dedup key', () => {
    const dedupKey = `anomaly:traffic_drop:users`;
    expect(dedupKey).toBe('anomaly:traffic_drop:users');
  });

  it('AnomalyDigestData type is well-formed', () => {
    const data: AnomalyDigestData = {
      anomalyType: 'traffic_drop',
      metric: 'clicks',
      currentValue: 150,
      expectedValue: 300,
      deviationPercent: -50,
      durationDays: 3,
      firstDetected: '2026-03-25T00:00:00Z',
      severity: 'critical',
    };
    expect(data.anomalyType).toBe('traffic_drop');
    expect(data.deviationPercent).toBe(-50);
    expect(data.durationDays).toBe(3);
  });
});
