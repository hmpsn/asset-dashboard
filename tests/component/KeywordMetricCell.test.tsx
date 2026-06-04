/**
 * Component tests for <KeywordMetricCell> — T6 Wave 2.
 *
 * Contract assertions (each distinguishes correct from broken):
 *   (a) mode="span" renders position as a colored #{n} span using the shared positionColor
 *   (b) mode="badge" renders a <Badge> with the shared positionTone
 *   (c) kdForm="kd-percent" → "KD {n}%" colored via kdColor;
 *       kdForm="difficulty" → "Difficulty {n}" also colored via kdColor
 *   (d) the ~ partial-match marker appears only when partialMatch=true
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeywordMetricCell } from '../../src/components/shared/KeywordMetricCell';
import { positionColor, positionTone } from '../../src/components/ui/constants';
import { kdColor } from '../../src/components/page-intelligence/pageIntelligenceDisplay';

describe('KeywordMetricCell', () => {
  // --- (a) mode="span" position rendering ---
  describe('mode="span" (admin)', () => {
    it('renders position as a #N span with the shared positionColor class', () => {
      const { container } = render(
        <KeywordMetricCell volume={1200} difficulty={45} position={5} mode="span" kdForm="kd-percent" />,
      );
      // The span must contain "#5"
      const posSpan = container.querySelector('span[data-testid="position-span"]');
      expect(posSpan).not.toBeNull();
      expect(posSpan!.textContent).toBe('#5');
      // The class must match the authority (≤10 → text-accent-success)
      expect(posSpan!.className).toContain(positionColor(5));
    });

    it('renders position=#25 (>20) with danger color from shared authority', () => {
      const { container } = render(
        <KeywordMetricCell volume={500} difficulty={60} position={25} mode="span" kdForm="kd-percent" />,
      );
      const posSpan = container.querySelector('span[data-testid="position-span"]');
      expect(posSpan).not.toBeNull();
      // >20 band → text-accent-danger
      expect(posSpan!.className).toContain(positionColor(25));
      expect(posSpan!.className).toContain('text-accent-danger');
    });

    it('renders no position element when position is undefined', () => {
      const { container } = render(
        <KeywordMetricCell volume={1200} difficulty={45} mode="span" kdForm="kd-percent" />,
      );
      expect(container.querySelector('span[data-testid="position-span"]')).toBeNull();
    });
  });

  // --- (b) mode="badge" position rendering ---
  describe('mode="badge" (client)', () => {
    it('renders position via Badge with shared positionTone', () => {
      // position=5 → positionTone(5)='emerald' → Badge with emerald classes
      const { container } = render(
        <KeywordMetricCell volume={1200} difficulty={45} position={5} mode="badge" kdForm="difficulty" />,
      );
      // mode="badge" should render a wrapper with a Badge inside
      const wrapper = container.querySelector('span[data-testid="position-badge"]');
      expect(wrapper).not.toBeNull();
      // The inner Badge span (child of wrapper) carries the emerald tone class
      const innerBadge = wrapper!.querySelector('span');
      expect(innerBadge).not.toBeNull();
      // Badge with tone=emerald (soft variant) gets bg-emerald-500/8 text-emerald-400/80
      expect(innerBadge!.className).toContain('emerald');
    });

    it('renders Badge with amber tone for position=15 (>10 ≤20)', () => {
      const { container } = render(
        <KeywordMetricCell volume={500} difficulty={60} position={15} mode="badge" kdForm="difficulty" />,
      );
      const wrapper = container.querySelector('span[data-testid="position-badge"]');
      expect(wrapper).not.toBeNull();
      // positionTone(15)='amber'
      expect(positionTone(15)).toBe('amber');
      const innerBadge = wrapper!.querySelector('span');
      expect(innerBadge!.className).toContain('amber');
    });

    it('renders dash Badge when position is undefined in badge mode', () => {
      const { container } = render(
        <KeywordMetricCell volume={500} difficulty={60} mode="badge" kdForm="difficulty" />,
      );
      // When no position: renders "—" zinc badge
      const wrapper = container.querySelector('span[data-testid="position-badge"]');
      expect(wrapper).not.toBeNull();
      expect(wrapper!.textContent).toBe('—');
    });
  });

  // --- (c) kdForm rendering ---
  describe('KD form rendering', () => {
    it('kdForm="kd-percent" renders "KD 45%" with kdColor class for kd=45', () => {
      const { container } = render(
        <KeywordMetricCell volume={1200} difficulty={45} position={5} mode="span" kdForm="kd-percent" />,
      );
      const kdSpan = container.querySelector('span[data-testid="kd-span"]');
      expect(kdSpan).not.toBeNull();
      expect(kdSpan!.textContent).toBe('KD 45%');
      // kd=45 → ≤50 → text-accent-warning
      expect(kdSpan!.className).toContain(kdColor(45));
      expect(kdSpan!.className).toContain('text-accent-warning');
    });

    it('kdForm="difficulty" renders "Difficulty 45" with kdColor class for kd=45', () => {
      const { container } = render(
        <KeywordMetricCell volume={1200} difficulty={45} position={5} mode="badge" kdForm="difficulty" />,
      );
      const kdSpan = container.querySelector('span[data-testid="kd-span"]');
      expect(kdSpan).not.toBeNull();
      expect(kdSpan!.textContent).toBe('Difficulty 45');
      // Same kdColor — both forms share the authority
      expect(kdSpan!.className).toContain(kdColor(45));
    });

    it('kdForm="kd-percent" renders "KD 75%" with danger color for kd=75', () => {
      const { container } = render(
        <KeywordMetricCell volume={500} difficulty={75} position={8} mode="span" kdForm="kd-percent" />,
      );
      const kdSpan = container.querySelector('span[data-testid="kd-span"]');
      expect(kdSpan!.textContent).toBe('KD 75%');
      expect(kdSpan!.className).toContain('text-accent-danger');
    });

    it('does not render KD span when difficulty is 0 or undefined', () => {
      const { container: c1 } = render(
        <KeywordMetricCell volume={500} mode="span" kdForm="kd-percent" />,
      );
      expect(c1.querySelector('span[data-testid="kd-span"]')).toBeNull();

      const { container: c2 } = render(
        <KeywordMetricCell volume={500} difficulty={0} mode="span" kdForm="kd-percent" />,
      );
      expect(c2.querySelector('span[data-testid="kd-span"]')).toBeNull();
    });
  });

  // --- (d) partial-match marker ---
  describe('partial-match marker', () => {
    it('renders ~ marker when partialMatch=true', () => {
      const { container } = render(
        <KeywordMetricCell volume={1200} difficulty={45} position={5} mode="badge" kdForm="difficulty" partialMatch />,
      );
      // The ~ marker is a span with the partial-match title
      const markers = container.querySelectorAll('span[title*="similar keyword"]');
      expect(markers.length).toBeGreaterThan(0);
    });

    it('does NOT render ~ marker when partialMatch is omitted (default false)', () => {
      const { container } = render(
        <KeywordMetricCell volume={1200} difficulty={45} position={5} mode="badge" kdForm="difficulty" />,
      );
      expect(container.querySelectorAll('span[title*="similar keyword"]').length).toBe(0);
    });

    it('does NOT render ~ marker when partialMatch=false', () => {
      const { container } = render(
        <KeywordMetricCell volume={1200} difficulty={45} position={5} mode="badge" kdForm="difficulty" partialMatch={false} />,
      );
      expect(container.querySelectorAll('span[title*="similar keyword"]').length).toBe(0);
    });
  });

  // --- Volume rendering ---
  describe('volume rendering', () => {
    it('formats volume with fmtNum and appends /mo', () => {
      render(
        <KeywordMetricCell volume={1200} mode="span" kdForm="kd-percent" />,
      );
      // 1200 → fmtNum → "1.2K" → "1.2K/mo"
      expect(screen.getByText('1.2K/mo')).toBeInTheDocument();
    });

    it('does not render volume when volume is 0 or undefined', () => {
      const { container: c1 } = render(
        <KeywordMetricCell mode="span" kdForm="kd-percent" />,
      );
      expect(c1.querySelector('span[data-testid="volume-span"]')).toBeNull();

      const { container: c2 } = render(
        <KeywordMetricCell volume={0} mode="span" kdForm="kd-percent" />,
      );
      expect(c2.querySelector('span[data-testid="volume-span"]')).toBeNull();
    });

    it('formats large volume with M suffix', () => {
      render(
        <KeywordMetricCell volume={2_000_000} mode="span" kdForm="kd-percent" />,
      );
      expect(screen.getByText('2.0M/mo')).toBeInTheDocument();
    });
  });
});
