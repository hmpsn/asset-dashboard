import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrategyStalenessNudges } from '../../../src/components/strategy/StrategyStalenessNudges';

const baseProps = {
  hasVolumeValidation: true,
  localSyncApplies: false,
  strategyStaleVsLocal: false,
  lastLocalRefreshAt: null,
  lastStrategyGeneratedAt: null,
  dismissedRefreshAt: null,
  onDismiss: vi.fn(),
  onGenerate: vi.fn(),
};

describe('StrategyStalenessNudges', () => {
  describe('unvalidated strategy warning', () => {
    it('renders the warning when hasVolumeValidation is false', () => {
      render(<StrategyStalenessNudges {...baseProps} hasVolumeValidation={false} />);
      expect(
        screen.getByText(/This strategy was generated without keyword volume validation/),
      ).toBeTruthy();
    });

    it('does not render the warning when hasVolumeValidation is true', () => {
      render(<StrategyStalenessNudges {...baseProps} hasVolumeValidation={true} />);
      expect(
        screen.queryByText(/This strategy was generated without keyword volume validation/),
      ).toBeNull();
    });
  });

  describe('reverse-staleness nudge', () => {
    it('renders the nudge when localSyncApplies && strategyStaleVsLocal && dismissedRefreshAt !== lastLocalRefreshAt', () => {
      render(
        <StrategyStalenessNudges
          {...baseProps}
          localSyncApplies={true}
          strategyStaleVsLocal={true}
          lastLocalRefreshAt="2026-06-10T00:00:00Z"
          dismissedRefreshAt={null}
        />,
      );
      expect(screen.getByTestId('reverse-staleness-nudge')).toBeTruthy();
    });

    it('does not render the nudge when dismissedRefreshAt === lastLocalRefreshAt', () => {
      render(
        <StrategyStalenessNudges
          {...baseProps}
          localSyncApplies={true}
          strategyStaleVsLocal={true}
          lastLocalRefreshAt="2026-06-10T00:00:00Z"
          dismissedRefreshAt="2026-06-10T00:00:00Z"
        />,
      );
      expect(screen.queryByTestId('reverse-staleness-nudge')).toBeNull();
    });

    it('does not render the nudge when localSyncApplies is false', () => {
      render(
        <StrategyStalenessNudges
          {...baseProps}
          localSyncApplies={false}
          strategyStaleVsLocal={true}
          lastLocalRefreshAt="2026-06-10T00:00:00Z"
          dismissedRefreshAt={null}
        />,
      );
      expect(screen.queryByTestId('reverse-staleness-nudge')).toBeNull();
    });

    it('does not render the nudge when strategyStaleVsLocal is false', () => {
      render(
        <StrategyStalenessNudges
          {...baseProps}
          localSyncApplies={true}
          strategyStaleVsLocal={false}
          lastLocalRefreshAt="2026-06-10T00:00:00Z"
          dismissedRefreshAt={null}
        />,
      );
      expect(screen.queryByTestId('reverse-staleness-nudge')).toBeNull();
    });

    it('clicking Generate Strategy calls onGenerate', () => {
      const onGenerate = vi.fn();
      render(
        <StrategyStalenessNudges
          {...baseProps}
          localSyncApplies={true}
          strategyStaleVsLocal={true}
          lastLocalRefreshAt="2026-06-10T00:00:00Z"
          dismissedRefreshAt={null}
          onGenerate={onGenerate}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Generate Strategy/i }));
      expect(onGenerate).toHaveBeenCalledOnce();
    });

    it('clicking Dismiss calls onDismiss', () => {
      const onDismiss = vi.fn();
      render(
        <StrategyStalenessNudges
          {...baseProps}
          localSyncApplies={true}
          strategyStaleVsLocal={true}
          lastLocalRefreshAt="2026-06-10T00:00:00Z"
          dismissedRefreshAt={null}
          onDismiss={onDismiss}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });
});
