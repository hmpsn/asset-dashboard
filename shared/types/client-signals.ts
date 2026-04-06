// shared/types/client-signals.ts

export type ClientSignalType = 'content_interest' | 'service_interest';
export type ClientSignalStatus = 'new' | 'reviewed' | 'actioned';

export interface ClientSignalMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A recorded client intent signal — created when the AI detects purchase/service intent in client chat. */
export interface ClientSignal {
  id: string;
  workspaceId: string;
  /** Display name of the workspace, denormalized for admin inbox rendering. */
  workspaceName: string;
  /** content_interest: asked about blogs/writing. service_interest: asked about pricing/next steps. */
  type: ClientSignalType;
  status: ClientSignalStatus;
  /** Last 10 messages from the chat session at the moment of signal creation. */
  chatContext: ClientSignalMessage[];
  /** The user message that triggered intent detection. */
  triggerMessage: string;
  createdAt: string;
  updatedAt: string;
}
