import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDataDir } from './data-dir.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';


const log = createLogger('stripe-config');
// --- Types ---

export interface StripeProductPrice {
  productType: string;
  stripePriceId: string;
  displayName: string;
  priceUsd: number;
  enabled: boolean;
}

export interface StripeConfig {
  secretKey: string;           // encrypted at rest
  webhookSecret: string;       // encrypted at rest
  publishableKey: string;      // NOT encrypted (public key, safe for frontend)
  products: StripeProductPrice[];
  updatedAt: string;
}

// --- Encryption ---

// Derive a key from APP_PASSWORD or a fallback machine-specific seed
function deriveKey(): Buffer {
  const seed = process.env.APP_PASSWORD || process.env.STRIPE_CONFIG_KEY || 'asset-dashboard-default-key';
  return crypto.scryptSync(seed, 'stripe-config-salt', 32);
}

function encrypt(text: string): string {
  if (!text) return '';
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(data: string): string {
  if (!data) return '';
  try {
    const [ivHex, tagHex, encHex] = data.split(':');
    const key = deriveKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8');
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'stripe-config/decrypt: programming error');
    return '';
  }
}

// --- Storage ---

function configPath(): string {
  return path.join(getDataDir('config'), 'stripe.json');
}

function readRawConfig(): { secretKey: string; webhookSecret: string; publishableKey?: string; products: StripeProductPrice[]; updatedAt: string } | null {
  const fp = configPath();
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch (err) {
    log.debug({ err }, 'stripe-config/readRawConfig: expected error — degrading gracefully');
    return null;
  }
}

// --- Public API ---

/** Read the full config with decrypted keys (server-side only) */
export function getStripeConfig(): StripeConfig | null {
  const raw = readRawConfig();
  if (!raw) return null;
  return {
    secretKey: decrypt(raw.secretKey),
    webhookSecret: decrypt(raw.webhookSecret),
    publishableKey: raw.publishableKey || '',
    products: raw.products || [],
    updatedAt: raw.updatedAt,
  };
}

/** Read config safe for API response (keys masked) */
export function getStripeConfigSafe(): { configured: boolean; hasSecretKey: boolean; hasWebhookSecret: boolean; hasPublishableKey: boolean; publishableKey: string; products: StripeProductPrice[]; updatedAt: string | null } {
  const raw = readRawConfig();
  if (!raw) return { configured: false, hasSecretKey: false, hasWebhookSecret: false, hasPublishableKey: false, publishableKey: '', products: [], updatedAt: null };
  const sk = decrypt(raw.secretKey);
  const whs = decrypt(raw.webhookSecret);
  const pk = raw.publishableKey || '';
  return {
    configured: !!sk,
    hasSecretKey: !!sk,
    hasWebhookSecret: !!whs,
    hasPublishableKey: !!pk,
    publishableKey: pk,
    products: raw.products || [],
    updatedAt: raw.updatedAt,
  };
}

/** Save Stripe keys (only updates non-empty values) */
export function saveStripeKeys(secretKey?: string, webhookSecret?: string, publishableKey?: string): void {
  const raw = readRawConfig() || { secretKey: '', webhookSecret: '', publishableKey: '', products: [], updatedAt: '' };
  if (secretKey !== undefined && secretKey !== '') raw.secretKey = encrypt(secretKey);
  if (webhookSecret !== undefined && webhookSecret !== '') raw.webhookSecret = encrypt(webhookSecret);
  if (publishableKey !== undefined && publishableKey !== '') raw.publishableKey = publishableKey; // Not encrypted — public key
  raw.updatedAt = new Date().toISOString();
  fs.writeFileSync(configPath(), JSON.stringify(raw, null, 2));
}

/** Save product price mappings */
export function saveStripeProducts(products: StripeProductPrice[]): void {
  const raw = readRawConfig() || { secretKey: '', webhookSecret: '', products: [], updatedAt: '' };
  raw.products = products;
  raw.updatedAt = new Date().toISOString();
  fs.writeFileSync(configPath(), JSON.stringify(raw, null, 2));
}

/** Clear all Stripe config */
export function clearStripeConfig(): void {
  const fp = configPath();
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

/** Get the decrypted secret key (used by stripe.ts to init SDK) */
export function getStripeSecretKey(): string {
  // Env var takes precedence (for CI/Docker deployments)
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
  const config = getStripeConfig();
  return config?.secretKey || '';
}

/** Get the decrypted webhook secret */
export function getStripeWebhookSecret(): string {
  if (process.env.STRIPE_WEBHOOK_SECRET) return process.env.STRIPE_WEBHOOK_SECRET;
  const config = getStripeConfig();
  return config?.webhookSecret || '';
}

/** Get the publishable key (safe for frontend) */
export function getStripePublishableKey(): string {
  if (process.env.STRIPE_PUBLISHABLE_KEY) return process.env.STRIPE_PUBLISHABLE_KEY;
  const raw = readRawConfig();
  return raw?.publishableKey || '';
}

/** Get the Price ID for a product type — checks on-disk config first, then env var */
export function getStripePriceId(productType: string, envKey: string): string {
  // On-disk config takes precedence
  const config = readRawConfig();
  if (config?.products) {
    const product = config.products.find(p => p.productType === productType && p.enabled);
    if (product?.stripePriceId) return product.stripePriceId;
  }
  // Fall back to env var
  return process.env[envKey] || '';
}
