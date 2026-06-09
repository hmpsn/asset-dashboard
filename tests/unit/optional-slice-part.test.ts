import { describe, expect, it, vi } from 'vitest';

import { readOptionalSlicePart } from '../../server/intelligence/optional-slice-part.js';

describe('readOptionalSlicePart', () => {
  it('returns the computed value when the read succeeds', async () => {
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
    };

    const result = await readOptionalSlicePart(
      'assembleContentPipeline: suggested briefs',
      'ws_1',
      0,
      () => 3,
      { logger, warnProgrammingErrors: true },
    );

    expect(result).toBe(3);
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs debug and returns the fallback for expected optional failures', async () => {
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
    };

    const result = await readOptionalSlicePart(
      'assembleContentPipeline: suggested briefs',
      'ws_2',
      0,
      () => {
        throw new Error('store unavailable');
      },
      { logger, warnProgrammingErrors: true },
    );

    expect(result).toBe(0);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws_2', err: expect.any(Error) }),
      'assembleContentPipeline: suggested briefs optional, degrading gracefully',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs warn for programming errors when escalation is enabled', async () => {
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
    };

    const result = await readOptionalSlicePart(
      'assembleContentPipeline: suggested briefs',
      'ws_3',
      0,
      () => {
        throw new TypeError('wrong export');
      },
      { logger, warnProgrammingErrors: true },
    );

    expect(result).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws_3',
        err: expect.any(TypeError),
      }),
      'assembleContentPipeline: suggested briefs programming error',
    );
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('supports custom log messages and context', async () => {
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
    };
    const context = {
      err: new Error('store unavailable'),
      subsystem: 'custom',
    };

    const result = await readOptionalSlicePart(
      'assembleContentPipeline: suggested briefs',
      'ws_4',
      0,
      () => {
        throw context.err;
      },
      {
        logger,
        debugMessage: 'custom debug message',
        logContext: context,
      },
    );

    expect(result).toBe(0);
    expect(logger.debug).toHaveBeenCalledWith(context, 'custom debug message');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
