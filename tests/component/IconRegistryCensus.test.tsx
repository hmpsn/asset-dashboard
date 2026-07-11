import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from '../../src/components/ui/Icon';
import { ICON_NAMES } from '../../src/components/ui/iconNames';

describe('Font Awesome registry render census', () => {
  it('renders every semantic key through its registered Sharp Regular glyph class', () => {
    const entries = Object.entries(ICON_NAMES);
    render(
      <div>
        {entries.map(([name]) => (
          <Icon key={name} name={name} data-testid={`icon-${name}`} />
        ))}
      </div>,
    );

    expect(entries).toHaveLength(52);
    for (const [name, glyph] of entries) {
      const wrapper = screen.getByTestId(`icon-${name}`);
      const renderedGlyph = wrapper.querySelector('i');
      expect(renderedGlyph, name).not.toBeNull();
      expect(renderedGlyph, name).toHaveClass('fa-sharp', 'fa-regular', `fa-${glyph}`);
    }
  });
});
