/**
 * Mock factory for Anthropic callAnthropic helper.
 * Use setupAnthropicMocks() in beforeEach to intercept server/anthropic-helpers.ts.
 */
import { vi } from 'vitest';

interface CapturedCall {
  feature: string;
  messages: unknown[];
  model?: string;
  system?: string;
}

interface AnthropicChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const DEFAULT_RESULT: AnthropicChatResult = {
  text: '',
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

const responseMap = new Map<string, () => AnthropicChatResult>();
const errorMap = new Map<string, string>();
const capturedCalls: CapturedCall[] = [];

/**
 * Configure mock to return specific text for a feature.
 */
export function mockAnthropicResponse(feature: string, text: string): void {
  errorMap.delete(feature);
  responseMap.set(feature, () => ({
    ...DEFAULT_RESULT,
    text,
  }));
}

/**
 * Configure mock to return JSON (stringified) for a feature.
 */
export function mockAnthropicJsonResponse(feature: string, data: unknown): void {
  errorMap.delete(feature);
  responseMap.set(feature, () => ({
    ...DEFAULT_RESULT,
    text: JSON.stringify(data),
  }));
}

/**
 * Configure mock to throw an error for a feature.
 */
export function mockAnthropicError(feature: string, message: string): void {
  responseMap.delete(feature);
  errorMap.set(feature, message);
}

/**
 * Get captured calls (feature, messages, model, system).
 */
export function getCapturedAnthropicCalls(): CapturedCall[] {
  return [...capturedCalls];
}

/**
 * Reset all mock state.
 */
export function resetAnthropicMocks(): void {
  responseMap.clear();
  errorMap.clear();
  capturedCalls.length = 0;
}

/**
 * Setup - mocks the anthropic-helpers module via vi.mock.
 * Call this at the top level of your test file (outside describe/it)
 * or in a beforeEach block.
 */
export function setupAnthropicMocks(): void {
  vi.mock('../../server/anthropic-helpers.js', () => ({
    callAnthropic: vi.fn(async (opts: { feature: string; messages: unknown[]; model?: string; system?: string }) => {
      capturedCalls.push({
        feature: opts.feature,
        messages: opts.messages,
        model: opts.model,
        system: opts.system,
      });

      const errorMessage = errorMap.get(opts.feature);
      if (errorMessage) {
        throw new Error(errorMessage);
      }

      const factory = responseMap.get(opts.feature);
      if (factory) {
        return factory();
      }

      return { ...DEFAULT_RESULT };
    }),
    isAnthropicConfigured: vi.fn(() => true),
  }));
}
