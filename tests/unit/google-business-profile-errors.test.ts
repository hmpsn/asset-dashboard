import { describe, expect, it } from 'vitest';
import { GoogleProviderError } from '../../server/google-provider-client.js';
import {
  googleBusinessProfileProviderErrorMessage,
  googleBusinessProfileProviderResponseStatus,
} from '../../server/google-business-profile-errors.js';

describe('Google Business Profile provider errors', () => {
  it('turns Google API-disabled bodies into an actionable setup message', () => {
    const error = new GoogleProviderError({
      source: 'gbp',
      endpoint: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      kind: 'http',
      status: 403,
      body: JSON.stringify({
        error: {
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'SERVICE_DISABLED' }],
        },
      }),
    });

    expect(googleBusinessProfileProviderErrorMessage(error)).toMatch(/required My Business API is disabled/i);
    expect(googleBusinessProfileProviderResponseStatus(error)).toBe(502);
  });

  it('asks for reconnect when Google reports insufficient OAuth scopes', () => {
    const error = new GoogleProviderError({
      source: 'gbp',
      endpoint: 'https://mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations',
      kind: 'http',
      status: 403,
      body: 'Request had insufficient authentication scopes. ACCESS_TOKEN_SCOPE_INSUFFICIENT',
    });

    expect(googleBusinessProfileProviderErrorMessage(error)).toMatch(/business.manage scope/i);
  });
});
