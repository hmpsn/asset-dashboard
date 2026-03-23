/**
 * Shared JWT configuration — single source of truth for JWT_SECRET.
 * Fails startup if JWT_SECRET is not set in production.
 */

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable must be set in production');
}

export const JWT_SECRET = process.env.JWT_SECRET || 'hmpsn-studio-dev-secret-change-in-prod';
