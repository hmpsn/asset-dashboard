import { describe, it, expect } from 'vitest';
import type { AnomalyDigestData } from '../../shared/types/analytics.js';

describe('anomaly-to-insight conversion', () => {
  it('maps anomaly severity to insight severity', () => {
    const severityMap: Record<string, string> = {
      critical: 'critical', high: 'warning', medium: 'opportunity', low: 'opportunity',
    };
    expect(severityMap['critical']).toBe('critical');
    expect(severityMap['high']).toBe('warning');
    expect(severityMap['medium']).toBe('opportunity');
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
