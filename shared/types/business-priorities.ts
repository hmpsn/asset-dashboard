export interface BusinessPriority {
  text: string;
  category: string;
}

export interface BusinessPrioritiesResponse {
  priorities: BusinessPriority[];
  updatedAt: string | null;
}

export interface BusinessPrioritiesSaveRequest {
  priorities: BusinessPriority[];
  expectedUpdatedAt?: string | null;
}

export interface BusinessPrioritiesSaveResponse extends BusinessPrioritiesResponse {
  saved: number;
}

export interface BusinessPrioritiesConflictResponse extends BusinessPrioritiesResponse {
  error: string;
}
