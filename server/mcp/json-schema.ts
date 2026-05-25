import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export function toMcpJsonSchema(schema: ZodTypeAny): { type: 'object'; [key: string]: unknown } {
  const raw = zodToJsonSchema(schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  if ('$schema' in raw) {
    const { $schema: _drop, ...rest } = raw;
    if (rest.type === 'object') return rest as { type: 'object'; [key: string]: unknown };
    return { type: 'object', ...rest };
  }
  if (raw.type === 'object') return raw as { type: 'object'; [key: string]: unknown };
  return { type: 'object', ...raw };
}
