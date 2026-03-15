import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// SQLite migrations now run once in tests/global-setup.ts (before workers start)

afterEach(() => {
  cleanup();
});
