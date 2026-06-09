import { isProgrammingError } from '../errors.js';

type OptionalSliceLogger = {
  debug(context: object, message: string): void;
  warn(context: object, message: string): void;
};

type ReadOptionalSlicePartOptions = {
  logger: OptionalSliceLogger;
  debugMessage?: string;
  logContext?: object | ((err: unknown, workspaceId: string) => object);
  warnProgrammingErrors?: boolean;
  warnMessage?: string;
};

export async function readOptionalSlicePart<T>(
  label: string,
  workspaceId: string,
  fallback: T,
  read: () => Promise<T> | T,
  {
    logger,
    debugMessage = `${label} optional, degrading gracefully`,
    logContext,
    warnProgrammingErrors = false,
    warnMessage = `${label} programming error`,
  }: ReadOptionalSlicePartOptions,
): Promise<T> {
  try {
    return await read();
  } catch (err) {
    const context =
      typeof logContext === 'function'
        ? logContext(err, workspaceId)
        : (logContext ?? { err, workspaceId });
    if (warnProgrammingErrors && isProgrammingError(err)) {
      logger.warn(context, warnMessage);
    } else {
      logger.debug(context, debugMessage);
    }
    return fallback;
  }
}
