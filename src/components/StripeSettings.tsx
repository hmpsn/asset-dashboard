import { useState, useEffect, useCallback } from 'react';
import {
  CreditCard, Eye, EyeOff, Save, Trash2, Loader2,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, DollarSign,
} from 'lucide-react';
import { SectionCard, Badge, Button, FormInput, Icon, IconButton } from './ui';
import { useToast } from '../hooks/useToast';
import { stripe } from '../api';

interface StripeProduct {
  productType: string;
  stripePriceId: string;
  displayName: string;
  priceUsd: number;
  enabled: boolean;
  recurring?: boolean;
  group?: string;
}

interface StripeConfigState {
  configured: boolean;
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  hasPublishableKey: boolean;
  publishableKey: string;
  products: StripeProduct[];
  updatedAt: string | null;
}

// Default product catalog (matches server/stripe.ts PRODUCT_MAP)
const DEFAULT_PRODUCTS: StripeProduct[] = [
  // Dashboard plan subscriptions (recurring)
  { productType: 'plan_growth',      displayName: 'Growth Plan',              priceUsd: 249,  stripePriceId: '', enabled: true, recurring: true, group: 'Dashboard Plans' },
  { productType: 'plan_premium',     displayName: 'Premium Plan',             priceUsd: 999,  stripePriceId: '', enabled: true, recurring: true, group: 'Dashboard Plans' },
  // Content subscriptions (recurring)
  { productType: 'content_starter',  displayName: 'Starter Content (2 posts/mo)', priceUsd: 500,  stripePriceId: '', enabled: true, recurring: true, group: 'Content Subscriptions' },
  { productType: 'content_growth',   displayName: 'Growth Content (4 posts/mo)',  priceUsd: 900,  stripePriceId: '', enabled: true, recurring: true, group: 'Content Subscriptions' },
  { productType: 'content_scale',    displayName: 'Scale Content (8 posts/mo)',   priceUsd: 1600, stripePriceId: '', enabled: true, recurring: true, group: 'Content Subscriptions' },
  // One-time content products
  { productType: 'brief_blog',       displayName: 'Blog Post Brief',       priceUsd: 125,  stripePriceId: '', enabled: true, group: 'Briefs' },
  { productType: 'brief_landing',    displayName: 'Landing Page Brief',    priceUsd: 150,  stripePriceId: '', enabled: true, group: 'Briefs' },
  { productType: 'brief_service',    displayName: 'Service Page Brief',    priceUsd: 150,  stripePriceId: '', enabled: true, group: 'Briefs' },
  { productType: 'brief_location',   displayName: 'Location Page Brief',   priceUsd: 150,  stripePriceId: '', enabled: true, group: 'Briefs' },
  { productType: 'brief_product',    displayName: 'Product Page Brief',    priceUsd: 150,  stripePriceId: '', enabled: true, group: 'Briefs' },
  { productType: 'brief_pillar',     displayName: 'Pillar/Hub Page Brief', priceUsd: 200,  stripePriceId: '', enabled: true, group: 'Briefs' },
  { productType: 'brief_resource',   displayName: 'Resource/Guide Brief',  priceUsd: 150,  stripePriceId: '', enabled: true, group: 'Briefs' },
  { productType: 'post_draft',       displayName: 'Blog Post — AI Draft',  priceUsd: 350,  stripePriceId: '', enabled: true, group: 'Posts' },
  { productType: 'post_polished',    displayName: 'Blog Post — Polished',  priceUsd: 500,  stripePriceId: '', enabled: true, group: 'Posts' },
  { productType: 'post_premium',     displayName: 'Blog Post — Premium',   priceUsd: 1000, stripePriceId: '', enabled: true, group: 'Posts' },
  { productType: 'schema_page',      displayName: 'Schema — Per Page',     priceUsd: 39,   stripePriceId: '', enabled: true, group: 'Schema & Strategy' },
  { productType: 'schema_10',        displayName: 'Schema Pack (10pg)',    priceUsd: 299,  stripePriceId: '', enabled: true, group: 'Schema & Strategy' },
  { productType: 'strategy',         displayName: 'Keyword Strategy',      priceUsd: 400,  stripePriceId: '', enabled: true, group: 'Schema & Strategy' },
  { productType: 'strategy_refresh', displayName: 'Strategy Refresh',      priceUsd: 200,  stripePriceId: '', enabled: true, group: 'Schema & Strategy' },
  { productType: 'fix_meta',         displayName: 'Metadata Optimization', priceUsd: 20,   stripePriceId: '', enabled: true, group: 'Fixes' },
  { productType: 'fix_alt',          displayName: 'Alt Text — Full Site', priceUsd: 50,  stripePriceId: '', enabled: true, group: 'Fixes' },
  { productType: 'fix_redirect',     displayName: 'Redirect Fix',         priceUsd: 19,   stripePriceId: '', enabled: true, group: 'Fixes' },
  { productType: 'fix_meta_10',      displayName: 'Metadata Pack (10pg)', priceUsd: 179,  stripePriceId: '', enabled: true, group: 'Fixes' },
];

export function StripeSettings() {
  const [config, setConfig] = useState<StripeConfigState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingProducts, setSavingProducts] = useState(false);
  const { toast, setToast } = useToast();
  const showToast = useCallback((message: string, type: 'success' | 'error') => setToast({ message, type }), [setToast]);

  // Key inputs
  const [secretKey, setSecretKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [publishableKey, setPublishableKey] = useState('');
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);

  // Products
  const [products, setProducts] = useState<StripeProduct[]>([]);
  const [productsExpanded, setProductsExpanded] = useState(false);

  useEffect(() => {
    stripe.getConfig()
      .then((data) => {
        const cfg = data as StripeConfigState | null;
        setConfig(cfg);
        // Merge saved products with defaults
        if (cfg?.products && cfg.products.length > 0) {
          const merged = DEFAULT_PRODUCTS.map(dp => {
            const saved = cfg.products.find(p => p.productType === dp.productType);
            return saved ? { ...dp, ...saved } : dp;
          });
          setProducts(merged);
        } else {
          setProducts(DEFAULT_PRODUCTS);
        }
      })
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  const saveKeys = async () => {
    if (!secretKey && !webhookSecret && !publishableKey) return;
    setSaving(true);
    try {
      const data = await stripe.saveKeys({
        secretKey: secretKey || undefined,
        webhookSecret: webhookSecret || undefined,
        publishableKey: publishableKey || undefined,
      });
      setConfig(data as StripeConfigState);
      setSecretKey('');
      setWebhookSecret('');
      setPublishableKey('');
      showToast('Stripe keys saved successfully', 'success');
    } catch (err) {
      console.error('StripeSettings operation failed:', err);
      showToast('Failed to save Stripe keys', 'error');
    }
    setSaving(false);
  };

  const saveProductConfig = async () => {
    setSavingProducts(true);
    try {
      await stripe.saveProducts({ products });
      showToast('Product configuration saved', 'success');
    } catch (err) {
      console.error('StripeSettings operation failed:', err);
      showToast('Failed to save product configuration', 'error');
    }
    setSavingProducts(false);
  };

  const clearConfig = async () => {
    if (!confirm('Remove all Stripe configuration? This cannot be undone.')) return;
    try {
      await stripe.deleteConfig();
      setConfig({ configured: false, hasSecretKey: false, hasWebhookSecret: false, hasPublishableKey: false, publishableKey: '', products: [], updatedAt: null });
      setProducts(DEFAULT_PRODUCTS);
      showToast('Stripe configuration cleared', 'success');
    } catch (err) {
      console.error('StripeSettings operation failed:', err);
      showToast('Failed to clear configuration', 'error');
    }
  };

  const updateProduct = (idx: number, patch: Partial<StripeProduct>) => {
    setProducts(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  };

  if (loading) {
    return (
      <SectionCard title="Payments" titleIcon={<Icon as={CreditCard} size="md" className="text-teal-400" />}>
        <div className="flex items-center justify-center py-6">
          <Icon as={Loader2} size="md" className="animate-spin text-[var(--brand-text-muted)]" />
        </div>
      </SectionCard>
    );
  }

  const configuredCount = products.filter(p => p.stripePriceId && p.enabled).length;

  return (
    <SectionCard
      title="Payments"
      titleIcon={<Icon as={CreditCard} size="md" className="text-teal-400" />}
      action={
        config?.configured ? (
          <Badge label="Connected" color="emerald" />
        ) : (
          <Badge label="Not configured" color="zinc" />
        )
      }
    >
      {/* Toast */}
      {toast && (
        <div className={`mb-3 px-3 py-2 rounded-[var(--radius-lg)] t-caption font-medium flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20' : 'bg-red-500/8 text-red-400/80 border border-red-500/20'
        }`}>
          {toast.type === 'success'
            ? <Icon as={CheckCircle2} size="sm" />
            : <Icon as={AlertTriangle} size="sm" />}
          {toast.message}
        </div>
      )}

      <div className="space-y-4">
        {/* Status summary */}
        <div className="flex items-center gap-3 t-caption">
          <div className="flex items-center gap-1.5">
            {config?.hasSecretKey
              ? <Icon as={CheckCircle2} size="sm" className="text-emerald-400/80" />
              : <Icon as={AlertTriangle} size="sm" className="text-[var(--brand-border-hover)]" />}
            <span className={config?.hasSecretKey ? 'text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)]'}>Secret Key</span>
          </div>
          <div className="flex items-center gap-1.5">
            {config?.hasWebhookSecret
              ? <Icon as={CheckCircle2} size="sm" className="text-emerald-400/80" />
              : <Icon as={AlertTriangle} size="sm" className="text-[var(--brand-border-hover)]" />}
            <span className={config?.hasWebhookSecret ? 'text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)]'}>Webhook Secret</span>
          </div>
          <div className="flex items-center gap-1.5">
            {config?.hasPublishableKey
              ? <Icon as={CheckCircle2} size="sm" className="text-emerald-400/80" />
              : <Icon as={AlertTriangle} size="sm" className="text-[var(--brand-border-hover)]" />}
            <span className={config?.hasPublishableKey ? 'text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)]'}>Publishable Key</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Icon as={DollarSign} size="sm" className={configuredCount > 0 ? 'text-emerald-400/80' : 'text-[var(--brand-border-hover)]'} />
            <span className={configuredCount > 0 ? 'text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)]'}>{configuredCount}/{products.length} products</span>
          </div>
        </div>

        {/* API Keys */}
        <div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-2">API Keys</div>
          <div className="space-y-2">
            <div>
              <label className="t-caption-sm text-[var(--brand-text)] block mb-1">Secret Key {config?.hasSecretKey && <span className="text-emerald-400/80">(saved)</span>}</label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <FormInput
                    type={showSecretKey ? 'text' : 'password'}
                    value={secretKey}
                    onChange={setSecretKey}
                    placeholder={config?.hasSecretKey ? '••••••••••••••••' : 'sk_test_... or sk_live_...'}
                    className="w-full px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption bg-[var(--surface-3)]/50 border border-[var(--brand-border)] text-[var(--brand-text-bright)] placeholder:text-[var(--brand-border-hover)] focus:outline-none focus:border-teal-500/50 pr-8 font-mono"
                  />
                  <IconButton
                    onClick={() => setShowSecretKey(!showSecretKey)}
                    icon={showSecretKey ? EyeOff : Eye}
                    label={showSecretKey ? 'Hide secret key' : 'Show secret key'}
                    title={showSecretKey ? 'Hide secret key' : 'Show secret key'}
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="t-caption-sm text-[var(--brand-text)] block mb-1">Webhook Secret {config?.hasWebhookSecret && <span className="text-emerald-400/80">(saved)</span>}</label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <FormInput
                    type={showWebhookSecret ? 'text' : 'password'}
                    value={webhookSecret}
                    onChange={setWebhookSecret}
                    placeholder={config?.hasWebhookSecret ? '••••••••••••••••' : 'whsec_...'}
                    className="w-full px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption bg-[var(--surface-3)]/50 border border-[var(--brand-border)] text-[var(--brand-text-bright)] placeholder:text-[var(--brand-border-hover)] focus:outline-none focus:border-teal-500/50 pr-8 font-mono"
                  />
                  <IconButton
                    onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                    icon={showWebhookSecret ? EyeOff : Eye}
                    label={showWebhookSecret ? 'Hide webhook secret' : 'Show webhook secret'}
                    title={showWebhookSecret ? 'Hide webhook secret' : 'Show webhook secret'}
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="t-caption-sm text-[var(--brand-text)] block mb-1">Publishable Key {config?.hasPublishableKey && <span className="text-emerald-400/80">(saved)</span>}</label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <FormInput
                    type="text"
                    value={publishableKey}
                    onChange={setPublishableKey}
                    placeholder={config?.hasPublishableKey ? config.publishableKey.slice(0, 12) + '...' : 'pk_test_... or pk_live_...'}
                    className="w-full px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption bg-[var(--surface-3)]/50 border border-[var(--brand-border)] text-[var(--brand-text-bright)] placeholder:text-[var(--brand-border-hover)] focus:outline-none focus:border-teal-500/50 font-mono"
                  />
                </div>
              </div>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">Optional public key reference. Checkout redirects use the Secret Key and Price IDs.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={saveKeys}
                disabled={saving || (!secretKey && !webhookSecret && !publishableKey)}
                loading={saving}
                icon={Save}
                variant="ghost"
                size="sm"
                className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption font-medium bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 border border-teal-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save Keys
              </Button>
              {config?.configured && (
                <Button
                  onClick={clearConfig}
                  icon={Trash2}
                  variant="ghost"
                  size="sm"
                  className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption font-medium text-red-400 hover:bg-red-500/10 border border-[var(--brand-border)] hover:border-red-500/20 transition-all"
                >
                  Disconnect
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Product Price IDs */}
        <div>
          <Button
            onClick={() => setProductsExpanded(!productsExpanded)}
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 px-0 py-0 h-auto text-left group hover:bg-transparent"
          >
            <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">Product Price IDs</div>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">({configuredCount} configured)</span>
            {productsExpanded
              ? <Icon as={ChevronUp} size="sm" className="text-[var(--brand-text-muted)] ml-auto" />
              : <Icon as={ChevronDown} size="sm" className="text-[var(--brand-text-muted)] ml-auto" />}
          </Button>

          {productsExpanded && (
            <div className="mt-2 space-y-1.5">
              <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">
                Paste the <code className="text-[var(--brand-text)]">price_...</code> ID from your Stripe Dashboard → Products for each item.
              </p>
              {(() => {
                let lastGroup = '';
                return products.map((product, idx) => {
                  const showGroupHeader = product.group && product.group !== lastGroup;
                  if (product.group) lastGroup = product.group;
                  return (
                    <div key={product.productType}>
                      {showGroupHeader && (
                        <div className={`t-caption-sm uppercase tracking-wider font-medium mt-3 mb-1.5 flex items-center gap-2 ${
                          product.recurring ? 'text-teal-400' : 'text-[var(--brand-text-muted)]'
                        }`}>
                          {product.group}
                          {product.recurring && <span className="t-caption-sm px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-400 normal-case tracking-normal font-medium">recurring</span>}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => updateProduct(idx, { enabled: !product.enabled })}
                          variant="ghost"
                          size="sm"
                          className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                            product.enabled ? 'bg-teal-500/20 border-teal-500/40' : 'bg-[var(--surface-3)] border-[var(--brand-border)]'
                          } p-0`}
                          title={product.enabled ? `Disable ${product.displayName}` : `Enable ${product.displayName}`}
                          aria-label={product.enabled ? `Disable ${product.displayName}` : `Enable ${product.displayName}`}
                        >
                          {product.enabled && <Icon as={CheckCircle2} size="xs" className="text-teal-400" />}
                        </Button>
                        <span className={`t-caption-sm w-44 truncate flex-shrink-0 ${product.enabled ? 'text-[var(--brand-text)]' : 'text-[var(--brand-border-hover)]'}`}>
                          {product.displayName}
                        </span>
                        <div className="flex items-center w-16 flex-shrink-0">
                          <span className="t-caption-sm text-[var(--brand-text-muted)]">$</span>
                          <FormInput
                            type="number"
                            value={product.priceUsd}
                            onChange={value => updateProduct(idx, { priceUsd: Math.max(0, Number(value)) })}
                            disabled={!product.enabled}
                            className="w-full px-1 py-0.5 rounded t-caption-sm text-right bg-[var(--surface-3)]/50 border border-[var(--brand-border)] text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500/50 disabled:opacity-30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          {product.recurring && <span className="t-caption-sm text-[var(--brand-text-muted)] ml-0.5">/mo</span>}
                        </div>
                        <FormInput
                          type="text"
                          value={product.stripePriceId}
                          onChange={value => updateProduct(idx, { stripePriceId: value.trim() })}
                          placeholder="price_..."
                          disabled={!product.enabled}
                          className="flex-1 px-2 py-1 rounded t-caption-sm bg-[var(--surface-3)]/50 border border-[var(--brand-border)] text-[var(--brand-text-bright)] placeholder:text-[var(--brand-border-hover)] focus:outline-none focus:border-teal-500/50 font-mono disabled:opacity-30"
                        />
                      </div>
                    </div>
                  );
                });
              })()}
              <Button
                onClick={saveProductConfig}
                disabled={savingProducts}
                loading={savingProducts}
                icon={Save}
                variant="ghost"
                size="sm"
                className="mt-2 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption font-medium bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 border border-teal-500/20 transition-all disabled:opacity-40"
              >
                Save Products
              </Button>
            </div>
          )}
        </div>

        {/* Help text */}
        {!config?.configured && (
          <div className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed border-t border-[var(--brand-border)] pt-3">
            <strong className="text-[var(--brand-text)]">Setup:</strong> Create products in your{' '}
            <a href="https://dashboard.stripe.com/products" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 underline">
              Stripe Dashboard
            </a>
            , copy the <code className="text-[var(--brand-text)]">price_...</code> IDs, then add a webhook endpoint pointing to{' '}
            <code className="text-[var(--brand-text)]">/api/stripe/webhook</code> for events{' '}
            <code className="text-[var(--brand-text)]">checkout.session.completed</code> and{' '}
            <code className="text-[var(--brand-text)]">payment_intent.payment_failed</code>.
          </div>
        )}

        {config?.updatedAt && (
          <div className="t-caption-sm text-[var(--brand-text-muted)] pt-1">
            Last updated: {new Date(config.updatedAt).toLocaleString()}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
