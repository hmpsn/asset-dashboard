/**
 * Single source of truth for all data directory paths.
 * Every server module that reads/writes persistent data should import from here.
 *
 * Production: uses DATA_DIR env var (e.g. /var/data/asset-dashboard on Render).
 * Development: falls back to ~/.asset-dashboard for dedicated stores,
 *              ~/toUpload for upload-based stores (legacy compat).
 */
import fs from 'fs';
import path from 'path';
import { createLogger } from './logger.js';

const log = createLogger('data-dir');

const IS_PROD = process.env.NODE_ENV === 'production';

if (IS_PROD && !process.env.DATA_DIR) {
  log.warn('⚠️  DATA_DIR is not set in production — falling back to /tmp/asset-dashboard which is EPHEMERAL and will be wiped on deploy.');
}

/** Resolved root data directory */
export const DATA_BASE: string = process.env.DATA_DIR
  || (IS_PROD ? '/tmp/asset-dashboard' : '');

/**
 * Get a named subdirectory under DATA_BASE (e.g. 'reports', 'schemas', 'redirects').
 * Creates the directory if it doesn't exist.
 * In dev without DATA_DIR, falls back to ~/.asset-dashboard/<subdir>.
 */
export function getDataDir(subdir: string): string {
  const dir = DATA_BASE
    ? path.join(DATA_BASE, subdir)
    : path.join(process.env.HOME || '', '.asset-dashboard', subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get the uploads root directory (workspace folders, brand docs, config files).
 * In dev without DATA_DIR, falls back to ~/toUpload (legacy compat).
 */
export function getUploadRoot(): string {
  const dir = DATA_BASE
    ? path.join(DATA_BASE, 'uploads')
    : path.join(process.env.HOME || '', 'toUpload');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get the optimized files directory (compressed images, etc.).
 * In dev without DATA_DIR, falls back to ~/Optimized (legacy compat).
 */
export function getOptRoot(): string {
  const dir = DATA_BASE
    ? path.join(DATA_BASE, 'optimized')
    : path.join(process.env.HOME || '', 'Optimized');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
