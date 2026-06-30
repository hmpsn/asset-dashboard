export class KeywordStrategySynthesisError extends Error {
  statusCode: number;
  payload: { error: string; message?: string; raw?: string };

  constructor(statusCode: number, payload: { error: string; message?: string; raw?: string }) {
    super(payload.error);
    this.name = 'KeywordStrategySynthesisError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}
