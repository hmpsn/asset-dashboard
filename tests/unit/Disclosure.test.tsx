import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Disclosure } from '../../src/components/ui/Disclosure';

describe('Disclosure', () => {
  it('hides children when closed and shows them after clicking summary', () => {
    render(
      <Disclosure summary="Toggle me">
        <span>Hidden content</span>
      </Disclosure>,
    );

    // Native <details> without `open` hides content — check the details element
    const details = document.querySelector('details');
    expect(details).toBeTruthy();
    expect(details!.hasAttribute('open')).toBe(false);

    // Click the summary to open
    const summaryEl = document.querySelector('summary');
    fireEvent.click(summaryEl!);

    expect(details!.hasAttribute('open')).toBe(true);
  });

  it('renders with open attribute when defaultOpen is true', () => {
    render(
      <Disclosure summary="Always open" defaultOpen>
        <span>Visible content</span>
      </Disclosure>,
    );

    const details = document.querySelector('details');
    expect(details).toBeTruthy();
    expect(details!.hasAttribute('open')).toBe(true);
  });

  it('renders provided badges in the summary', () => {
    render(
      <Disclosure
        summary="With badges"
        badges={[
          { label: 'Alpha', tone: 'teal' },
          { label: 'Beta', tone: 'amber' },
        ]}
      >
        <span>Content</span>
      </Disclosure>,
    );

    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('container uses --radius-lg and NOT --radius-signature', () => {
    const { container } = render(
      <Disclosure summary="Radius check">
        <span>Content</span>
      </Disclosure>,
    );

    const details = container.querySelector('details');
    expect(details).toBeTruthy();

    // The class string must reference radius-lg
    const classStr = details!.className;
    expect(classStr).toContain('radius-lg');
    // Must NOT use the signature radius (reserved for StatCard/SectionCard)
    expect(classStr).not.toContain('radius-signature');
  });

  it('chevron rotation class is under motion-safe:', () => {
    const { container } = render(
      <Disclosure summary="Motion check">
        <span>Content</span>
      </Disclosure>,
    );

    // Find the icon span wrapping the chevron via data attribute
    const chevronWrapper = container.querySelector('[data-disclosure-chevron]');
    expect(chevronWrapper).toBeTruthy();
    const classStr = chevronWrapper!.className;
    // The rotation transition must be gated under motion-safe:
    expect(classStr).toMatch(/motion-safe:[^\s]*transition/);
    // The rotate must also be under group-open
    expect(classStr).toMatch(/group-open:[^\s]*rotate/);
  });
});
