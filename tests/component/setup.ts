import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

// SQLite migrations now run once in tests/global-setup.ts (before workers start)

expect.extend(axeMatchers);

afterEach(() => {
  cleanup();
});
