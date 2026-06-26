import { describe, expect, it } from 'vitest';
import { collectCircularComponents } from '../../scripts/check-circular-deps.js';

describe('check-circular-deps component clustering', () => {
  it('groups overlapping circular paths into one ratchetable component', () => {
    const components = collectCircularComponents([
      ['a.ts', 'b.ts'],
      ['b.ts', 'c.ts'],
      ['x.ts', 'y.ts'],
    ]);

    expect(components).toEqual([
      { files: ['a.ts', 'b.ts', 'c.ts'], cycleCount: 2 },
      { files: ['x.ts', 'y.ts'], cycleCount: 1 },
    ]);
  });

  it('sorts equal-sized components by cycle count before file name', () => {
    const components = collectCircularComponents([
      ['z.ts', 'y.ts'],
      ['m.ts', 'n.ts'],
      ['n.ts', 'm.ts'],
    ]);

    expect(components[0]).toEqual({ files: ['m.ts', 'n.ts'], cycleCount: 2 });
    expect(components[1]).toEqual({ files: ['y.ts', 'z.ts'], cycleCount: 1 });
  });
});
