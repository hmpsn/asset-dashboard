/**
 * Mock factory for Anthropic callAnthropic helper.
 * Importing this module intercepts server/anthropic-helpers.ts at module load.
 * Use setupAnthropicMocks()/resetAnthropicMocks() to clear mock state.
 */
import { vi } from 'vitest';

interface CapturedCall {
  feature: string;
  messages: { role: string; content: string }[];
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

const mockState = vi.hoisted(() => ({
  responseMap: new Map<string, () => AnthropicChatResult>(),
  errorMap: new Map<string, string>(),
  capturedCalls: [] as CapturedCall[],
}));

vi.mock('../../server/anthropic-helpers.js', () => ({
  callAnthropic: vi.fn(async (opts: { feature: string; messages: unknown[]; model?: string; system?: string }) => {
    mockState.capturedCalls.push({
      feature: opts.feature,
      messages: opts.messages as CapturedCall['messages'],
      model: opts.model,
      system: opts.system,
    });

    const errorMessage = mockState.errorMap.get(opts.feature);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    const factory = mockState.responseMap.get(opts.feature);
    if (factory) {
      return factory();
    }

    return {
      text: '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
  }),
  isAnthropicConfigured: vi.fn(() => true),
}));

/**
 * Configure mock to return specific text for a feature.
 */
export function mockAnthropicResponse(feature: string, text: string): void {
  mockState.errorMap.delete(feature);
  mockState.responseMap.set(feature, () => ({
    ...DEFAULT_RESULT,
    text,
  }));
}

/**
 * Configure mock to return JSON (stringified) for a feature.
 */
export function mockAnthropicJsonResponse(feature: string, data: unknown): void {
  mockState.errorMap.delete(feature);
  mockState.responseMap.set(feature, () => ({
    ...DEFAULT_RESULT,
    text: JSON.stringify(data),
  }));
}

/**
 * Configure mock to throw an error for a feature.
 */
export function mockAnthropicError(feature: string, message: string): void {
  mockState.responseMap.delete(feature);
  mockState.errorMap.set(feature, message);
}

/**
 * Get captured calls (feature, messages, model, system).
 */
export function getCapturedAnthropicCalls(): CapturedCall[] {
  return [...mockState.capturedCalls];
}

/**
 * Reset all mock state.
 */
export function resetAnthropicMocks(): void {
  mockState.responseMap.clear();
  mockState.errorMap.clear();
  mockState.capturedCalls.length = 0;
}

/**
 * Setup - retained for existing tests; the module mock is registered at import time.
 */
export function setupAnthropicMocks(): void {
  resetAnthropicMocks();
}
