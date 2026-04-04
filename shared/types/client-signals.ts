// shared/types/client-signals.ts

export type ClientSignalType = 'content_interest' | 'service_interest';
export type ClientSignalStatus = 'new' | 'reviewed' | 'actioned';

export interface ClientSignalMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

/** A recorded client intent signal — created when a client taps a Service Interest CTA. */
export interface ClientSignal {
  id: string;
  workspaceId: string;
  /** content_interest: asked about blogs/writing. service_interest: asked about pricing/next steps. */
  type: ClientSignalType;
  /** Last 10 messages from the chat session at the moment of the tap. */
  chatContext: ClientSignalMessage[];
  status: ClientSignalStatus;
  createdAt: string;
}
