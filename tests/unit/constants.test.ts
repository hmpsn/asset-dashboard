import { describe, it, expect } from 'vitest';

// getCssVar is not exported — test indirectly via chartGridColor and chartTooltipStyle
import { chartGridColor, chartTooltipStyle } from '../../src/components/ui/constants';

describe('chartGridColor', () => {
  it('returns a non-empty string', () => {
    const color = chartGridColor();
    expect(typeof color).toBe('string');
    expect(color.length).toBeGreaterThan(0);
  });
});

describe('chartTooltipStyle', () => {
  it('returns an object with backgroundColor, color, and border', () => {
    const style = chartTooltipStyle();
    expect(style).toHaveProperty('backgroundColor');
    expect(style).toHaveProperty('color');
    expect(style).toHaveProperty('border');
    expect(style).toHaveProperty('borderRadius');
    expect(style).toHaveProperty('fontSize');
  });

  it('has matching backgroundColor and color types', () => {
    const style = chartTooltipStyle();
    expect(typeof style.backgroundColor).toBe('string');
    expect(typeof style.color).toBe('string');
  });
});
