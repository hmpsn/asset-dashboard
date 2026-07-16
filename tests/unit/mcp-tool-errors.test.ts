import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MCP_TOOL_ERROR_CODES } from '../../shared/types/mcp-runtime.js';
import {
  MCP_TOOL_ERROR_CONTRACTS,
  isValidatedMcpJsonV1ErrorResult,
  mcpJsonV1Error,
  mcpZodValidationError,
  mcpToolError,
  mcpUnexpectedToolError,
} from '../../server/mcp/tool-errors.js';

function parseTextPayload(result: ReturnType<typeof mcpJsonV1Error>): unknown {
  const first = result.content[0];
  expect(first?.type).toBe('text');
  return JSON.parse(first?.type === 'text' ? first.text : 'null');
}

describe('MCP tool error contracts', () => {
  it('exposes immutable contract identifiers', () => {
    expect(Object.isFrozen(MCP_TOOL_ERROR_CONTRACTS)).toBe(true);
  });

  it('returns the stable JSON v1 envelope for new tools', () => {
    const result = mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.CONFLICT,
      message: 'The source revision changed.',
      retryable: true,
      details: {
        expectedRevision: 4,
        currentRevision: 5,
      },
    });

    expect(result.isError).toBe(true);
    expect(parseTextPayload(result)).toEqual({
      code: 'conflict',
      message: 'The source revision changed.',
      retryable: true,
      details: {
        expectedRevision: 4,
        currentRevision: 5,
      },
    });
    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.content)).toBe(true);
    expect(Object.isFrozen(result.content[0])).toBe(true);
    expect(isValidatedMcpJsonV1ErrorResult({ ...result })).toBe(false);
  });

  it('turns Zod failures into field-addressed constraints without echoing input', () => {
    const parsed = z.object({
      questionnaire: z.object({
        business: z.object({ description: z.string().max(5) }),
      }),
    }).safeParse({ questionnaire: { business: { description: 'private oversized input' } } });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const payload = parseTextPayload(mcpZodValidationError(parsed.error));
    expect(payload).toEqual({
      code: 'validation_failed',
      message: expect.stringContaining('questionnaire.business.description'),
      retryable: false,
      details: {
        field_path: 'questionnaire.business.description',
        constraint: expect.stringContaining('5'),
        issue_code: 'too_big',
      },
    });
    expect(JSON.stringify(payload)).not.toContain('private oversized input');
  });

  it('keeps isolated legacy compatibility fixtures byte-compatible while selecting JSON v1', () => {
    const descriptor = {
      legacyText: 'Forbidden: this API key cannot access that workspace.',
      envelope: {
        code: MCP_TOOL_ERROR_CODES.FORBIDDEN,
        message: 'This API key cannot access that workspace.',
        retryable: false,
      },
    } as const;

    const legacy = mcpToolError(MCP_TOOL_ERROR_CONTRACTS.LEGACY_TEXT, descriptor);
    expect(legacy).toEqual({
      isError: true,
      content: [{
        type: 'text',
        text: 'Forbidden: this API key cannot access that workspace.',
      }],
    });

    const json = mcpToolError(MCP_TOOL_ERROR_CONTRACTS.JSON_V1, descriptor);
    expect(parseTextPayload(json)).toEqual(descriptor.envelope);
  });

  it('drops prohibited detail fields instead of exposing raw inputs or evidence', () => {
    const result = mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      message: 'The request could not be validated.',
      retryable: false,
      details: {
        field: 'expected_revision',
        rawArgs: '{"apiKey":"mcp_secret"}',
        prompt: 'private prompt',
        evidence: 'private evidence',
        stack: 'Error: boom',
        apiToken: 'token-value',
        key: 'generic-key',
        keyHash: 'hash-value',
        credential: 'credential-value',
        privateKey: 'private-key-value',
        plaintextKey: 'plaintext-key-value',
        auth: 'auth-value',
      },
    });

    const payload = parseTextPayload(result);
    expect(payload).toEqual({
      code: 'validation_failed',
      message: 'The request could not be validated.',
      retryable: false,
      details: { field: 'expected_revision' },
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /mcp_secret|private prompt|private evidence|Error: boom|token-value|generic-key|hash-value|credential-value|private-key-value|plaintext-key-value|auth-value/,
    );
  });

  it('bounds public message and detail strings', () => {
    const oversizedKey = `field_${'k'.repeat(200)}`;
    const result = mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      message: 'm'.repeat(2_000),
      retryable: false,
      details: {
        field: 'd'.repeat(2_000),
        [oversizedKey]: 'must not survive',
      },
    });

    const payload = parseTextPayload(result) as {
      message: string;
      details: { field: string };
    };
    expect(payload.message).toHaveLength(500);
    expect(payload.message.endsWith('…')).toBe(true);
    expect(payload.details.field).toHaveLength(1_000);
    expect(payload.details.field.endsWith('…')).toBe(true);
    expect(payload.details).not.toHaveProperty(oversizedKey);
  });

  it('uses a generic unexpected-error payload without accepting or echoing an Error', () => {
    const result = mcpUnexpectedToolError(MCP_TOOL_ERROR_CONTRACTS.JSON_V1);

    expect(parseTextPayload(result)).toEqual({
      code: 'internal_error',
      message: 'The tool could not complete because of an internal error.',
      retryable: false,
    });
  });

  it('fails a malformed runtime envelope closed to generic internal_error', () => {
    const result = mcpJsonV1Error({
      code: 'unregistered_code',
      message: 'must not survive',
      retryable: 'yes',
    } as never);

    expect(parseTextPayload(result)).toEqual({
      code: 'internal_error',
      message: 'The tool could not complete because of an internal error.',
      retryable: false,
    });
    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
  });
});
