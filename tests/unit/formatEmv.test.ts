import { describe, it, expect } from 'vitest';
import { formatEmv } from '../../src/lib/formatEmv';

describe('formatEmv', () => {
  it('renders <$1/wk below a dollar', () => {
    expect(formatEmv(0.4)).toBe('<$1/wk');
    expect(formatEmv(0)).toBe('<$1/wk');
  });

  it('renders whole dollars/wk under 1k', () => {
    expect(formatEmv(250)).toBe('$250/wk');
    expect(formatEmv(999)).toBe('$999/wk');
  });

  it('renders $X.Yk/wk between 1k and 10k', () => {
    expect(formatEmv(2500)).toBe('$2.5k/wk');
    expect(formatEmv(1000)).toBe('$1.0k/wk');
  });

  it('renders $Xk/wk at 10k and above', () => {
    expect(formatEmv(12000)).toBe('$12k/wk');
    expect(formatEmv(10000)).toBe('$10k/wk');
  });
});
