/**
 * Mock factory for OpenAI callOpenAI helper.
 * Use setupOpenAIMocks() in beforeEach to intercept server/openai-helpers.ts.
 */
import { vi } from 'vitest';

interface CapturedCall {
  feature: string;
  messages: unknown[];
  model?: string;
}

interface OpenAIChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const DEFAULT_RESULT: OpenAIChatResult = {
  text: '',
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

const responseMap = new Map<string, () => OpenAIChatResult>();
const errorMap = new Map<string, string>();
const capturedCalls: CapturedCall[] = [];

/**
 * Configure mock to return specific text for a feature.
 */
export function mockOpenAIResponse(feature: string, text: string): void {
  errorMap.delete(feature);
  responseMap.set(feature, () => ({
    ...DEFAULT_RESULT,
    text,
  }));
}

/**
 * Configure mock to return JSON (stringified) for a feature.
 */
export function mockOpenAIJsonResponse(feature: string, data: unknown): void {
  errorMap.delete(feature);
  responseMap.set(feature, () => ({
    ...DEFAULT_RESULT,
    text: JSON.stringify(data),
  }));
}

/**
 * Configure mock to throw an error for a feature.
 */
export function mockOpenAIError(feature: string, message: string): void {
  responseMap.delete(feature);
  errorMap.set(feature, message);
}

/**
 * Get captured calls (feature, messages, model).
 */
export function getCapturedOpenAICalls(): CapturedCall[] {
  return [...capturedCalls];
}

/**
 * Reset all mock state.
 */
export function resetOpenAIMocks(): void {
  responseMap.clear();
  errorMap.clear();
  capturedCalls.length = 0;
}

/**
 * Setup - mocks the openai-helpers module via vi.mock.
 * Call this at the top level of your test file (outside describe/it)
 * or in a beforeEach block.
 */
export function setupOpenAIMocks(): void {
  vi.mock('../../server/openai-helpers.js', () => ({
    callOpenAI: vi.fn(async (opts: { feature: string; messages: unknown[]; model?: string }) => {
      capturedCalls.push({
        feature: opts.feature,
        messages: opts.messages,
        model: opts.model,
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
    logTokenUsage: vi.fn(),
    flushToDisk: vi.fn(),
    getTokenUsage: vi.fn(() => ({ entries: [], totalTokens: 0, estimatedCost: 0 })),
    getUsageByDay: vi.fn(() => []),
    getUsageByFeature: vi.fn(() => []),
    getTimeSaved: vi.fn(() => ({ totalMinutesSaved: 0, totalHoursSaved: 0, operationCount: 0, byFeature: {} })),
    parseAIJson: vi.fn((raw: string) => {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(cleaned);
    }),
  }));
}
