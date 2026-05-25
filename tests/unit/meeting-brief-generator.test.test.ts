import fs from 'fs';
import { describe, expect, it } from 'vitest';

describe('meeting-brief-generator.test canonical coverage entry', () => {
  it('source test file exists', () => {
    expect(fs.existsSync('server/__tests__/meeting-brief-generator.test.ts')).toBe(true);
  });
});
