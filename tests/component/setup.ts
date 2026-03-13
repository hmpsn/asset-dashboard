import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { runMigrations } from '../../server/db/index.js';

// Ensure SQLite tables exist before any tests run
runMigrations();

afterEach(() => {
  cleanup();
});
