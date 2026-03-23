import { useState, useEffect, useCallback } from 'react';
import {
  CreditCard, Eye, EyeOff, Save, Trash2, Loader2,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, DollarSign,
} from 'lucide-react';
import { SectionCard, Badge } from './ui';
import { useToast } from '../hooks/useToast';

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
  const { toast, setToast, clearToast } = useToast();
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
    fetch('/api/stripe/config')
      .then(r => r.json())
      .then((data: StripeConfigState) => {
        setConfig(data);
        // Merge saved products with defaults
        if (data.products && data.products.length > 0) {
          const merged = DEFAULT_PRODUCTS.map(dp => {
            const saved = data.products.find(p => p.productType === dp.productType);
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
      const res = await fetch('/api/stripe/config/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secretKey: secretKey || undefined,
          webhookSecret: webhookSecret || undefined,
          publishableKey: publishableKey || undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      setConfig(data);
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
      const res = await fetch('/api/stripe/config/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products }),
      });
      if (!res.ok) throw new Error('Failed to save');
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
      await fetch('/api/stripe/config', { method: 'DELETE' });
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
      <SectionCard title="Payments" titleIcon={<CreditCard className="w-4 h-4 text-teal-400" />}>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
        </div>
      </SectionCard>
    );
  }

  const configuredCount = products.filter(p => p.stripePriceId && p.enabled).length;

  return (
    <SectionCard
      title="Payments"
      titleIcon={<CreditCard className="w-4 h-4 text-teal-400" />}
      action={
        config?.configured ? (
          <Badge label="Connected" color="green" />
        ) : (
          <Badge label="Not configured" color="zinc" />
        )
      }
    >
      {/* Toast */}
      {toast && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          {toast.message}
        </div>
      )}

      <div className="space-y-4">
        {/* Status summary */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            {config?.hasSecretKey ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <AlertTriangle className="w-3 h-3 text-zinc-600" />}
            <span className={config?.hasSecretKey ? 'text-zinc-300' : 'text-zinc-500'}>Secret Key</span>
          </div>
          <div className="flex items-center gap-1.5">
            {config?.hasWebhookSecret ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <AlertTriangle className="w-3 h-3 text-zinc-600" />}
            <span className={config?.hasWebhookSecret ? 'text-zinc-300' : 'text-zinc-500'}>Webhook Secret</span>
          </div>
          <div className="flex items-center gap-1.5">
            {config?.hasPublishableKey ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <AlertTriangle className="w-3 h-3 text-zinc-600" />}
            <span className={config?.hasPublishableKey ? 'text-zinc-300' : 'text-zinc-500'}>Publishable Key</span>
          </div>
          <div className="flex items-center gap-1.5">
            <DollarSign className={`w-3 h-3 ${configuredCount > 0 ? 'text-green-400' : 'text-zinc-600'}`} />
            <span className={configuredCount > 0 ? 'text-zinc-300' : 'text-zinc-500'}>{configuredCount}/{products.length} products</span>
          </div>
        </div>

        {/* API Keys */}
        <div>
          <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mb-2">API Keys</div>
          <div className="space-y-2">
            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Secret Key {config?.hasSecretKey && <span className="text-green-400">(saved)</span>}</label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <input
                    type={showSecretKey ? 'text' : 'password'}
                    value={secretKey}
                    onChange={e => setSecretKey(e.target.value)}
                    placeholder={config?.hasSecretKey ? '••••••••••••••••' : 'sk_test_... or sk_live_...'}
                    className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800/50 border border-zinc-700 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-500/50 pr-8 font-mono"
                  />
                  <button
                    onClick={() => setShowSecretKey(!showSecretKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showSecretKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Webhook Secret {config?.hasWebhookSecret && <span className="text-green-400">(saved)</span>}</label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <input
                    type={showWebhookSecret ? 'text' : 'password'}
                    value={webhookSecret}
                    onChange={e => setWebhookSecret(e.target.value)}
                    placeholder={config?.hasWebhookSecret ? '••••••••••••••••' : 'whsec_...'}
                    className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800/50 border border-zinc-700 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-500/50 pr-8 font-mono"
                  />
                  <button
                    onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showWebhookSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Publishable Key {config?.hasPublishableKey && <span className="text-green-400">(saved)</span>}</label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={publishableKey}
                    onChange={e => setPublishableKey(e.target.value)}
                    placeholder={config?.hasPublishableKey ? config.publishableKey.slice(0, 12) + '...' : 'pk_test_... or pk_live_...'}
                    className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800/50 border border-zinc-700 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-500/50 font-mono"
                  />
                </div>
              </div>
              <p className="text-[10px] text-zinc-600 mt-1">Required for inline payment form (Stripe Elements). Found in Stripe Dashboard → API keys.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={saveKeys}
                disabled={saving || (!secretKey && !webhookSecret && !publishableKey)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 border border-teal-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save Keys
              </button>
              {config?.configured && (
                <button
                  onClick={clearConfig}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:bg-red-500/10 border border-zinc-800 hover:border-red-500/20 transition-all"
                >
                  <Trash2 className="w-3 h-3" /> Disconnect
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Product Price IDs */}
        <div>
          <button
            onClick={() => setProductsExpanded(!productsExpanded)}
            className="flex items-center gap-2 w-full text-left group"
          >
            <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Product Price IDs</div>
            <span className="text-[11px] text-zinc-600">({configuredCount} configured)</span>
            {productsExpanded ? <ChevronUp className="w-3 h-3 text-zinc-500 ml-auto" /> : <ChevronDown className="w-3 h-3 text-zinc-500 ml-auto" />}
          </button>

          {productsExpanded && (
            <div className="mt-2 space-y-1.5">
              <p className="text-[11px] text-zinc-500 mb-2">
                Paste the <code className="text-zinc-400">price_...</code> ID from your Stripe Dashboard → Products for each item.
              </p>
              {(() => {
                let lastGroup = '';
                return products.map((product, idx) => {
                  const showGroupHeader = product.group && product.group !== lastGroup;
                  if (product.group) lastGroup = product.group;
                  return (
                    <div key={product.productType}>
                      {showGroupHeader && (
                        <div className={`text-[10px] uppercase tracking-wider font-medium mt-3 mb-1.5 flex items-center gap-2 ${
                          product.recurring ? 'text-teal-400' : 'text-zinc-500'
                        }`}>
                          {product.group}
                          {product.recurring && <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-400 normal-case tracking-normal font-medium">recurring</span>}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateProduct(idx, { enabled: !product.enabled })}
                          className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                            product.enabled ? 'bg-teal-500/20 border-teal-500/40' : 'bg-zinc-800 border-zinc-700'
                          }`}
                        >
                          {product.enabled && <CheckCircle2 className="w-2.5 h-2.5 text-teal-400" />}
                        </button>
                        <span className={`text-[11px] w-44 truncate flex-shrink-0 ${product.enabled ? 'text-zinc-300' : 'text-zinc-600'}`}>
                          {product.displayName}
                        </span>
                        <div className="flex items-center w-16 flex-shrink-0">
                          <span className="text-[11px] text-zinc-500">$</span>
                          <input
                            type="number"
                            value={product.priceUsd}
                            onChange={e => updateProduct(idx, { priceUsd: Math.max(0, Number(e.target.value)) })}
                            disabled={!product.enabled}
                            className="w-full px-1 py-0.5 rounded text-[11px] text-right bg-zinc-800/50 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-teal-500/50 disabled:opacity-30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          {product.recurring && <span className="text-[10px] text-zinc-600 ml-0.5">/mo</span>}
                        </div>
                        <input
                          type="text"
                          value={product.stripePriceId}
                          onChange={e => updateProduct(idx, { stripePriceId: e.target.value.trim() })}
                          placeholder="price_..."
                          disabled={!product.enabled}
                          className="flex-1 px-2 py-1 rounded text-[11px] bg-zinc-800/50 border border-zinc-700 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-500/50 font-mono disabled:opacity-30"
                        />
                      </div>
                    </div>
                  );
                });
              })()}
              <button
                onClick={saveProductConfig}
                disabled={savingProducts}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 border border-teal-500/20 transition-all disabled:opacity-40"
              >
                {savingProducts ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save Products
              </button>
            </div>
          )}
        </div>

        {/* Help text */}
        {!config?.configured && (
          <div className="text-[11px] text-zinc-500 leading-relaxed border-t border-zinc-800 pt-3">
            <strong className="text-zinc-400">Setup:</strong> Create products in your{' '}
            <a href="https://dashboard.stripe.com/products" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 underline">
              Stripe Dashboard
            </a>
            , copy the <code className="text-zinc-400">price_...</code> IDs, then add a webhook endpoint pointing to{' '}
            <code className="text-zinc-400">/api/stripe/webhook</code> for events{' '}
            <code className="text-zinc-400">checkout.session.completed</code> and{' '}
            <code className="text-zinc-400">payment_intent.payment_failed</code>.
          </div>
        )}

        {config?.updatedAt && (
          <div className="text-[11px] text-zinc-600 pt-1">
            Last updated: {new Date(config.updatedAt).toLocaleString()}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
