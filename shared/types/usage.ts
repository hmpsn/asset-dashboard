export type UsageTier = 'free' | 'growth' | 'premium';

export interface ChatUsageResponse {
  allowed: boolean;
  used: number;
  /** Monthly chat limit. `null` means unlimited. */
  limit: number | null;
  /** Remaining chats this month. `null` means unlimited. */
  remaining: number | null;
  tier: UsageTier;
}

export interface ChatLimitErrorResponse extends ChatUsageResponse {
  error: string;
  code: 'usage_limit';
  message: string;
}

export interface ClientSearchChatResponse {
  answer?: string;
  error?: string;
  sessionId?: string;
  detectedIntent?: 'content_interest' | 'service_interest' | null;
}
