/**
 * Unit tests for server/data-dir.ts — data directory resolution.
 *
 * These tests verify the path resolution logic by checking the returned
 * paths contain expected segments and that directories are created.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// We test path logic indirectly since module-level constants are resolved at import time.
// For DATA_DIR-based resolution, we test the exported functions.
import { getDataDir, getUploadRoot, getOptRoot, DATA_BASE } from '../../server/data-dir.js';

describe('data-dir', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    // Clean up any test directories we created
    for (const dir of createdDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* skip */ }
    }
    createdDirs.length = 0;
  });

  describe('getDataDir', () => {
    it('returns a path containing the subdirectory name', () => {
      const dir = getDataDir('test-subdir-' + Date.now());
      expect(dir).toContain('test-subdir-');
      expect(fs.existsSync(dir)).toBe(true);
      createdDirs.push(dir);
    });

    it('creates the directory if it does not exist', () => {
      const unique = 'unit-test-' + Date.now();
      const dir = getDataDir(unique);
      expect(fs.existsSync(dir)).toBe(true);
      createdDirs.push(dir);
    });

    it('returns consistent paths for the same subdirectory', () => {
      const name = 'consistent-' + Date.now();
      const a = getDataDir(name);
      const b = getDataDir(name);
      expect(a).toBe(b);
      createdDirs.push(a);
    });
  });

  describe('getUploadRoot', () => {
    it('returns a valid directory path', () => {
      const dir = getUploadRoot();
      expect(typeof dir).toBe('string');
      expect(dir.length).toBeGreaterThan(0);
      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  describe('getOptRoot', () => {
    it('returns a valid directory path', () => {
      const dir = getOptRoot();
      expect(typeof dir).toBe('string');
      expect(dir.length).toBeGreaterThan(0);
      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  describe('DATA_BASE', () => {
    it('is a string', () => {
      expect(typeof DATA_BASE).toBe('string');
    });
  });
});
