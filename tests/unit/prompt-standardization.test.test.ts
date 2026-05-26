import fs from 'fs';
import { describe, expect, it } from 'vitest';

describe('prompt-standardization.test canonical coverage entry', () => {
  it('source test file exists', () => {
    expect(fs.existsSync('server/__tests__/prompt-standardization.test.ts')).toBe(true);
  });
});
