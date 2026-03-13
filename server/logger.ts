import pino from 'pino';

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Root logger instance for the application.
 * - JSON output in production (for Render log aggregation)
 * - Pretty-printed in development (via pino-pretty)
 */
const logger = pino({
  level: process.env.LOG_LEVEL || (IS_PROD ? 'info' : 'debug'),
  ...(IS_PROD
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:mm:ss',
            ignore: 'pid,hostname,service',
          },
        },
      }),
  base: { service: 'asset-dashboard' },
});

/** Create a child logger with a module context field. */
export function createLogger(module: string): pino.Logger {
  return logger.child({ module });
}

export default logger;
