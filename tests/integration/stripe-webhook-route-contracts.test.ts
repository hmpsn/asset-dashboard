import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const stripeState = vi.hoisted(() => ({
  constructWebhookEvent: vi.fn(),
  handleWebhookEvent: vi.fn(),
}));

vi.mock('../../server/stripe.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/stripe.js')>();
  return {
    ...actual,
    constructWebhookEvent: stripeState.constructWebhookEvent,
    handleWebhookEvent: stripeState.handleWebhookEvent,
  };
});

let baseUrl = '';
let server: http.Server | undefined;
const originalAppPassword = process.env.APP_PASSWORD;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => err ? reject(err) : resolve());
  });
  server = undefined;
}

beforeAll(async () => {
  await startTestServer();
});

beforeEach(() => {
  stripeState.constructWebhookEvent.mockReset();
  stripeState.handleWebhookEvent.mockReset();
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('stripe webhook route contracts', () => {
  it('returns 400 when stripe-signature header is missing', async () => {
    const res = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'checkout.session.completed' }),
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body.error).toBe('Missing stripe-signature header');
    expect(stripeState.constructWebhookEvent).not.toHaveBeenCalled();
    expect(stripeState.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it('returns 400 when signature verification fails', async () => {
    stripeState.constructWebhookEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });

    const res = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'invalid-sig',
      },
      body: JSON.stringify({ type: 'checkout.session.completed' }),
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body.error).toBe('Webhook verification failed');
    expect(stripeState.constructWebhookEvent).toHaveBeenCalledTimes(1);
    expect(stripeState.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it('accepts a valid signature path and forwards event to handler', async () => {
    const event = { id: 'evt_test_route_contract', type: 'invoice.paid' };
    stripeState.constructWebhookEvent.mockReturnValue(event);
    stripeState.handleWebhookEvent.mockResolvedValue(undefined);

    const res = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'valid-sig',
      },
      body: JSON.stringify({ id: 'evt_test_route_contract', type: 'invoice.paid' }),
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(stripeState.constructWebhookEvent).toHaveBeenCalledTimes(1);
    const [rawBody, signature] = stripeState.constructWebhookEvent.mock.calls[0] as [unknown, unknown];
    expect(Buffer.isBuffer(rawBody)).toBe(true);
    expect(signature).toBe('valid-sig');
    expect(stripeState.handleWebhookEvent).toHaveBeenCalledWith(event);
  });
});
