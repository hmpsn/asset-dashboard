import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nodemailerMock = vi.hoisted(() => {
  const sendMail = vi.fn<
    (payload: { from: string; to: string; subject: string; html: string }) => Promise<void>
  >();
  const createTransport = vi.fn(() => ({ sendMail }));
  return { sendMail, createTransport };
});

const emailQueueMock = vi.hoisted(() => ({
  queueEmail: vi.fn<(event: Record<string, unknown>) => void>(),
  registerSendFn: vi.fn<(sendFn: (to: string, subject: string, html: string) => Promise<boolean>) => void>(),
  restoreQueue: vi.fn<() => void>(),
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn<(message: string) => void>(),
  error: vi.fn<(meta: Record<string, unknown>, message: string) => void>(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: nodemailerMock.createTransport },
  createTransport: nodemailerMock.createTransport,
}));

vi.mock('../../server/email-queue.js', () => ({
  queueEmail: emailQueueMock.queueEmail,
  registerSendFn: emailQueueMock.registerSendFn,
  restoreQueue: emailQueueMock.restoreQueue,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => loggerMock),
}));

const ORIGINAL_ENV = process.env;

function resetEmailEnv() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
  delete process.env.SMTP_FROM_NAME;
  delete process.env.NOTIFICATION_EMAIL;
}

function applyEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function loadEmailModule() {
  return import('../../server/email.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  resetEmailEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('server/email.ts', () => {
  describe('isEmailConfigured env matrix', () => {
    const cases = [
      {
        name: 'returns false when all SMTP vars are missing',
        env: {},
        expected: false,
      },
      {
        name: 'returns false when SMTP_HOST is missing',
        env: { SMTP_USER: 'mailer@example.com', SMTP_PASS: 'secret' },
        expected: false,
      },
      {
        name: 'returns false when SMTP_USER is missing',
        env: { SMTP_HOST: 'smtp.example.com', SMTP_PASS: 'secret' },
        expected: false,
      },
      {
        name: 'returns false when SMTP_PASS is missing',
        env: { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'mailer@example.com' },
        expected: false,
      },
      {
        name: 'returns true when required SMTP vars are present',
        env: { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'mailer@example.com', SMTP_PASS: 'secret' },
        expected: true,
      },
    ] as const;

    it.each(cases)('$name', async ({ env, expected }) => {
      applyEnv(env);
      const email = await loadEmailModule();
      expect(email.isEmailConfigured()).toBe(expected);
    });
  });

  describe('sendEmail', () => {
    it('returns true and sends mail when SMTP config is valid', async () => {
      applyEnv({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_USER: 'mailer@example.com',
        SMTP_PASS: 'secret',
        SMTP_FROM: 'sender@example.com',
        SMTP_FROM_NAME: 'Agency Team',
      });

      nodemailerMock.sendMail.mockResolvedValueOnce();

      const email = await loadEmailModule();
      const sent = await email.sendEmail('client@example.com', 'Subject line', '<p>Body</p>');

      expect(sent).toBe(true);
      expect(nodemailerMock.createTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'mailer@example.com', pass: 'secret' },
      });
      expect(nodemailerMock.sendMail).toHaveBeenCalledWith({
        from: '"Agency Team" <sender@example.com>',
        to: 'client@example.com',
        subject: 'Subject line',
        html: '<p>Body</p>',
      });
    });

    it('returns false and logs error when sendMail throws', async () => {
      applyEnv({
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'mailer@example.com',
        SMTP_PASS: 'secret',
      });

      const sendError = new Error('SMTP failure');
      nodemailerMock.sendMail.mockRejectedValueOnce(sendError);

      const email = await loadEmailModule();
      const sent = await email.sendEmail('client@example.com', 'Subject line', '<p>Body</p>');

      expect(sent).toBe(false);
      expect(loggerMock.error).toHaveBeenCalledWith({ err: sendError }, 'Failed to send');
    });

    it('returns false when SMTP is not configured', async () => {
      const email = await loadEmailModule();

      const sent = await email.sendEmail('client@example.com', 'Subject line', '<p>Body</p>');

      expect(sent).toBe(false);
      expect(nodemailerMock.createTransport).not.toHaveBeenCalled();
      expect(nodemailerMock.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('initEmailQueue', () => {
    it('registers send function and restores queue', async () => {
      const email = await loadEmailModule();

      email.initEmailQueue();

      expect(emailQueueMock.registerSendFn).toHaveBeenCalledTimes(1);
      expect(emailQueueMock.registerSendFn).toHaveBeenCalledWith(expect.any(Function));
      expect(emailQueueMock.restoreQueue).toHaveBeenCalledTimes(1);
      expect(loggerMock.info).toHaveBeenCalledWith('Queue initialized');
    });
  });

  describe('notify helpers', () => {
    it('notifyTeamNewRequest queues request_new event only when configured and notification email exists', async () => {
      const email = await loadEmailModule();

      email.notifyTeamNewRequest({
        workspaceName: 'Acme Co',
        workspaceId: 'ws-1',
        title: 'Need homepage copy update',
        description: 'Please refresh the hero copy this week',
        category: 'content',
      });
      expect(emailQueueMock.queueEmail).not.toHaveBeenCalled();

      applyEnv({
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'mailer@example.com',
        SMTP_PASS: 'secret',
      });
      email.notifyTeamNewRequest({
        workspaceName: 'Acme Co',
        workspaceId: 'ws-1',
        title: 'Need homepage copy update',
        description: 'Please refresh the hero copy this week',
        category: 'content',
      });
      expect(emailQueueMock.queueEmail).not.toHaveBeenCalled();

      process.env.NOTIFICATION_EMAIL = 'team@example.com';
      email.notifyTeamNewRequest({
        workspaceName: 'Acme Co',
        workspaceId: 'ws-1',
        title: 'Need homepage copy update',
        description: 'Please refresh the hero copy this week',
        category: 'content',
      });

      expect(emailQueueMock.queueEmail).toHaveBeenCalledTimes(1);
      expect(emailQueueMock.queueEmail).toHaveBeenCalledWith(expect.objectContaining({
        type: 'request_new',
        recipient: 'team@example.com',
        workspaceId: 'ws-1',
        workspaceName: 'Acme Co',
        data: expect.objectContaining({
          title: 'Need homepage copy update',
          category: 'content',
        }),
      }));
    });

    it('notifyClientTeamResponse queues request_response event when configured', async () => {
      const email = await loadEmailModule();

      email.notifyClientTeamResponse({
        clientEmail: 'client@example.com',
        workspaceName: 'Acme Co',
        workspaceId: 'ws-2',
        requestTitle: 'Update service page',
        noteContent: 'Done and ready for review',
        dashboardUrl: 'https://app.example.com/client/ws-2/inbox',
      });
      expect(emailQueueMock.queueEmail).not.toHaveBeenCalled();

      applyEnv({
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'mailer@example.com',
        SMTP_PASS: 'secret',
      });

      email.notifyClientTeamResponse({
        clientEmail: 'client@example.com',
        workspaceName: 'Acme Co',
        workspaceId: 'ws-2',
        requestTitle: 'Update service page',
        noteContent: 'Done and ready for review',
        dashboardUrl: 'https://app.example.com/client/ws-2/inbox',
      });

      expect(emailQueueMock.queueEmail).toHaveBeenCalledTimes(1);
      expect(emailQueueMock.queueEmail).toHaveBeenCalledWith(expect.objectContaining({
        type: 'request_response',
        recipient: 'client@example.com',
        workspaceId: 'ws-2',
        workspaceName: 'Acme Co',
        dashboardUrl: 'https://app.example.com/client/ws-2/inbox',
        data: expect.objectContaining({
          requestTitle: 'Update service page',
          noteContent: 'Done and ready for review',
        }),
      }));
    });
  });
});
