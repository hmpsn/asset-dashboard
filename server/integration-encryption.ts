import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const SALT = 'asset-dashboard.integration-encryption.v1';

export class IntegrationEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationEncryptionError';
  }
}

function resolveEncryptionKey(): string {
  const key =
    process.env.GOOGLE_OAUTH_ENCRYPTION_KEY ||
    process.env.INTEGRATION_CONFIG_KEY;
  if (key) return key;
  if (process.env.NODE_ENV === 'production') {
    throw new IntegrationEncryptionError(
      'GOOGLE_OAUTH_ENCRYPTION_KEY or INTEGRATION_CONFIG_KEY is required in production',
    );
  }
  return 'asset-dashboard-local-integration-encryption-key';
}

function deriveKey(): Buffer {
  return scryptSync(resolveEncryptionKey(), SALT, 32);
}

export function encryptIntegrationSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptIntegrationSecret(value: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split('.');
  if (version !== VERSION || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new IntegrationEncryptionError('Unsupported encrypted integration secret format');
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    deriveKey(),
    Buffer.from(ivRaw, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function assertIntegrationEncryptionConfigured(): void {
  resolveEncryptionKey();
}
