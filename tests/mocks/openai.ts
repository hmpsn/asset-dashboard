/**
 * Mock factory for OpenAI callOpenAI helper.
 * Importing this module intercepts server/openai-helpers.ts at module load.
 * Use setupOpenAIMocks()/resetOpenAIMocks() to clear mock state.
 */
import { vi } from 'vitest';

interface CapturedCall {
  feature: string;
  messages: { role: string; content: string }[];
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

const mockState = vi.hoisted(() => ({
  responseMap: new Map<string, () => OpenAIChatResult>(),
  errorMap: new Map<string, string>(),
  capturedCalls: [] as CapturedCall[],
}));

vi.mock('../../server/openai-helpers.js', () => ({
  callOpenAI: vi.fn(async (opts: { feature: string; messages: unknown[]; model?: string }) => {
    mockState.capturedCalls.push({
      feature: opts.feature,
      messages: opts.messages as CapturedCall['messages'],
      model: opts.model,
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
  logTokenUsage: vi.fn(),
  flushToDisk: vi.fn(),
  getTokenUsage: vi.fn(() => ({ entries: [], totalTokens: 0, estimatedCost: 0 })),
  getUsageByDay: vi.fn(() => []),
  getUsageByFeature: vi.fn(() => []),
  getTimeSaved: vi.fn(() => ({ totalMinutesSaved: 0, totalHoursSaved: 0, operationCount: 0, byFeature: {} })),
  parseAIJson: vi.fn((raw: string) => JSON.parse(raw)),
}));

/**
 * Configure mock to return specific text for a feature.
 */
export function mockOpenAIResponse(feature: string, text: string): void {
  mockState.errorMap.delete(feature);
  mockState.responseMap.set(feature, () => ({
    ...DEFAULT_RESULT,
    text,
  }));
}

/**
 * Configure mock to return JSON (stringified) for a feature.
 */
export function mockOpenAIJsonResponse(feature: string, data: unknown): void {
  mockState.errorMap.delete(feature);
  mockState.responseMap.set(feature, () => ({
    ...DEFAULT_RESULT,
    text: JSON.stringify(data),
  }));
}

/**
 * Configure mock to throw an error for a feature.
 */
export function mockOpenAIError(feature: string, message: string): void {
  mockState.responseMap.delete(feature);
  mockState.errorMap.set(feature, message);
}

/**
 * Get captured calls (feature, messages, model).
 */
export function getCapturedOpenAICalls(): CapturedCall[] {
  return [...mockState.capturedCalls];
}

/**
 * Reset all mock state.
 */
export function resetOpenAIMocks(): void {
  mockState.responseMap.clear();
  mockState.errorMap.clear();
  mockState.capturedCalls.length = 0;
}

/**
 * Setup - retained for existing tests; the module mock is registered at import time.
 */
export function setupOpenAIMocks(): void {
  resetOpenAIMocks();
}
