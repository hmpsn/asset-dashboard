import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ActionQueueStrip } from '../../src/components/client/Briefing/ActionQueueStrip';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

describe('ActionQueueStrip routing', () => {
  it('routes reply chips to inbox conversations deep-link', () => {
    render(
      <MemoryRouter initialEntries={['/client/ws_1/briefing']}>
        <Routes>
          <Route
            path="/client/:workspaceId/briefing"
            element={(
              <>
                <ActionQueueStrip
                  workspaceId="ws_1"
                  betaMode={false}
                  counts={{ approvals: 0, briefs: 0, posts: 0, replies: 1, contentPlan: 0 }}
                />
                <LocationProbe />
              </>
            )}
          />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '1 reply' }));
    expect(screen.getByTestId('location').textContent).toBe('/client/ws_1/inbox?tab=conversations');
  });
});
