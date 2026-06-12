/**
 * Zod request body validation middleware.
 *
 * Usage:
 *   import { validate, z } from '../middleware/validate.js';
 *   router.post('/api/foo', validate(z.object({ name: z.string() })), handler);
 */
import { type RequestHandler } from 'express';
import { type ZodType } from 'zod';
import { createLogger } from '../logger.js';

const log = createLogger('validate');

export { z } from 'zod';

/**
 * Returns Express middleware that validates `req.body` against the given Zod
 * schema. On success the parsed (and potentially transformed/defaulted) body
 * replaces `req.body`. On failure a 400 response with structured errors is
 * returned.
 */
export function validate(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      log.warn({ path: req.path, issues }, 'Request body validation failed');
      // Prefix the offending field path so the top-level `error` string names the
      // failing field (e.g. "name: Required"). Hand-written guards across the
      // codebase reference the field name in their 400 messages; routes migrated to
      // this middleware must keep that actionable convention. Falls back to the bare
      // message for top-level/whole-body issues with an empty path.
      const first = issues[0];
      const errorMessage = first.path ? `${first.path}: ${first.message}` : first.message;
      return res.status(400).json({ error: errorMessage, errors: issues });
    }
    // Replace body with parsed+transformed output (strips unknown keys, applies defaults, etc.)
    req.body = result.data;
    next();
  };
}
