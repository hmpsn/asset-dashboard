import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { SchemaCompletenessWidget, type PageWithFindings } from '../../src/components/schema/SchemaCompletenessWidget';
import type { ValidationFinding } from '../../shared/types/schema-validation';

function LocationCapture({ onLocation }: { onLocation: (loc: string) => void }) {
  const l = useLocation();
  onLocation(l.pathname + l.search);
  return null;
}

function renderWithRouter(pages: unknown[], workspaceId = 'ws_test') {
  let capturedLocation = '';
  const utils = render(
    <MemoryRouter initialEntries={[`/ws/${workspaceId}/seo-schema`]}>
      <Routes>
        {/* Admin workspace route */}
        <Route
          path="/ws/:workspaceId/*"
          element={
            <>
              <SchemaCompletenessWidget pages={pages as PageWithFindings[]} workspaceId={workspaceId} />
              <LocationCapture onLocation={loc => { capturedLocation = loc; }} />
            </>
          }
        />
        {/* Global-tab route — settings is a GLOBAL_TAB so adminPath returns /settings */}
        <Route
          path="/settings"
          element={
            <LocationCapture onLocation={loc => { capturedLocation = loc; }} />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { ...utils, getLocation: () => capturedLocation };
}

const finding = (severity: 'error' | 'warning', field: string): ValidationFinding => ({
  severity,
  type: 'Article',
  field,
  ruleId: severity === 'error' ? 'required-field-missing' : 'recommended-field-missing',
  message: `${field} missing`,
});

describe('SchemaCompletenessWidget', () => {
  it('renders the empty-state badge when no actionable findings exist', () => {
    // 'image' has no entry in FIELD_TARGETS, so it is non-actionable
    renderWithRouter([
      { pageId: 'p1', validationFindings: [] },
      { pageId: 'p2', validationFindings: [finding('error', 'image')] },
    ]);
    // Use exact text to distinguish from the card title "Schema profile completeness"
    expect(screen.getByText(/all pages emit recommended fields/i)).toBeInTheDocument();
  });

  it('renders progress bar at 50% when half of pages have actionable findings', () => {
    // p1 has no actionable issues; p2 has publisher.logo which IS in FIELD_TARGETS
    renderWithRouter([
      { pageId: 'p1', validationFindings: [] },
      { pageId: 'p2', validationFindings: [finding('error', 'publisher.logo')] },
    ]);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
  });

  it('groups findings by field and shows page count', () => {
    renderWithRouter([
      { pageId: 'p1', validationFindings: [finding('error', 'publisher.logo')] },
      { pageId: 'p2', validationFindings: [finding('error', 'publisher.logo')] },
      { pageId: 'p3', validationFindings: [finding('warning', 'address')] },
    ]);
    expect(screen.getByText('Publisher logo')).toBeInTheDocument();
    expect(screen.getByText('2 pages')).toBeInTheDocument();
    expect(screen.getByText('Business address')).toBeInTheDocument();
    expect(screen.getByText('1 page')).toBeInTheDocument();
  });

  it('navigates to settings?tab=features&focus=brandLogoUrl on Publisher logo click', () => {
    // adminPath(workspaceId, 'settings') returns '/settings' because 'settings' is a GLOBAL_TAB
    const { getLocation } = renderWithRouter([
      { pageId: 'p1', validationFindings: [finding('error', 'publisher.logo')] },
    ]);
    fireEvent.click(screen.getByText('Publisher logo'));
    expect(getLocation()).toContain('?tab=features&focus=brandLogoUrl');
  });

  it('errors sort above warnings', () => {
    renderWithRouter([
      { pageId: 'p1', validationFindings: [finding('warning', 'address')] },
      { pageId: 'p2', validationFindings: [finding('error', 'publisher.logo')] },
    ]);
    const buttons = screen.getAllByRole('button');
    const labels = buttons.map(b => b.textContent ?? '');
    const logoIdx = labels.findIndex(l => l.includes('Publisher logo'));
    const addressIdx = labels.findIndex(l => l.includes('Business address'));
    expect(logoIdx).toBeGreaterThanOrEqual(0);
    expect(addressIdx).toBeGreaterThan(logoIdx);
  });
});
