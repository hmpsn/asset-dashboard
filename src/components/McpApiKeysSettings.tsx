import { useMemo, useState } from 'react';
import { KeyRound, Copy, Check, Trash2, Loader2, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';
import { Icon, IconButton, Button, FormInput, FormSelect, ConfirmDialog, EmptyState } from './ui';
import { useToast } from './Toast';
import { useMcpApiKeys } from '../hooks/admin/useMcpApiKeys';
import { useWorkspaces } from '../hooks/admin/useWorkspaces';
import type { CreateMcpApiKeyResult, McpApiKeySummary } from '../../shared/types/mcp-api-keys';

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Admin Settings surface for per-workspace MCP API keys. Mints keys on top of the
 * retained env MCP_API_KEY master key; the plaintext is revealed exactly once at
 * creation (the server only stores a hash). Lives in the global /settings panel.
 */
export function McpApiKeysSettings() {
  const { toast } = useToast();
  const {
    keys, masterKeyConfigured, isLoading, isError, error,
    create, isCreating, revoke, isRevoking,
  } = useMcpApiKeys();
  const { data: workspaces } = useWorkspaces();

  const [workspaceId, setWorkspaceId] = useState('');
  const [label, setLabel] = useState('');
  const [revealed, setRevealed] = useState<CreateMcpApiKeyResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<McpApiKeySummary | null>(null);

  const workspaceOptions = useMemo(
    () => (workspaces ?? []).map((w) => ({ value: w.id, label: w.name })),
    [workspaces],
  );

  const canCreate = workspaceId !== '' && label.trim() !== '' && !isCreating;

  async function handleCreate() {
    if (!canCreate) return;
    try {
      const result = await create({ workspaceId, label: label.trim() });
      setRevealed(result);
      setCopied(false);
      setLabel('');
      toast(`Key created for ${result.key.workspaceName}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create key');
    }
  }

  async function handleCopy() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.plaintextKeyOnceShown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Copy failed — select the key and copy manually');
    }
  }

  function handleRevokeConfirmed() {
    if (!pendingRevoke) return;
    revoke(pendingRevoke.id);
    toast(`Revoked "${pendingRevoke.label}"`);
    setPendingRevoke(null);
  }

  return (
    // pr-check-disable-next-line -- hand-rolled section card with inner subsections; mirrors SectionCard brand signature intentionally (matches FeatureFlagSettings/StripeSettings)
    <section className="bg-[var(--surface-2)] overflow-hidden border border-[var(--brand-border)]" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
      <div className="px-5 py-4 border-b border-[var(--brand-border)] flex items-center gap-3">
        <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center">
          <Icon as={KeyRound} size="md" className="text-accent-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">MCP API Keys</h3>
          <p className="t-caption text-[var(--brand-text-muted)]">Per-workspace keys for the MCP server. Each key is scoped to one workspace; the plaintext is shown once.</p>
        </div>
        <span
          className={`t-caption-sm px-2 py-0.5 rounded font-medium shrink-0 inline-flex items-center gap-1 ${
            masterKeyConfigured
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-amber-500/10 text-amber-400'
          }`}
          title={masterKeyConfigured
            ? 'The env MCP_API_KEY admin master key is set — it grants all-workspace access.'
            : 'No env MCP_API_KEY master key is configured.'}
        >
          <Icon as={masterKeyConfigured ? ShieldCheck : ShieldAlert} size="sm" />
          {masterKeyConfigured ? 'Master key set' : 'No master key'}
        </span>
      </div>

      {/* Create form */}
      <div className="px-5 py-4 border-b border-[var(--brand-border)] flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 min-w-0">
          <label className="t-caption-sm font-medium text-[var(--brand-text-muted)] block mb-1">Workspace</label>
          <FormSelect
            options={workspaceOptions}
            value={workspaceId}
            onChange={setWorkspaceId}
            placeholder="Select a workspace…"
          />
        </div>
        <div className="flex-1 min-w-0">
          <label className="t-caption-sm font-medium text-[var(--brand-text-muted)] block mb-1">Label</label>
          <FormInput
            value={label}
            onChange={setLabel}
            placeholder="e.g. Claude desktop — read only"
            maxLength={120}
          />
        </div>
        <Button variant="primary" size="md" onClick={handleCreate} disabled={!canCreate}>
          {isCreating ? (
            <span className="inline-flex items-center gap-1.5"><Icon as={Loader2} size="sm" className="animate-spin" /> Creating…</span>
          ) : 'Create key'}
        </Button>
      </div>

      {/* One-time plaintext reveal */}
      {revealed && (
        <div className="px-5 py-4 border-b border-[var(--brand-border)] bg-teal-500/5">
          <div className="flex items-start gap-2 mb-2">
            <Icon as={AlertTriangle} size="sm" className="text-amber-400 mt-0.5 shrink-0" />
            <p className="t-caption text-[var(--brand-text)]">
              Copy this key now — it’s shown <span className="font-semibold">once</span> and can’t be retrieved later. Key for{' '}
              <span className="font-semibold">{revealed.key.workspaceName}</span> ({revealed.key.label}).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 t-mono text-[var(--brand-text-bright)] bg-[var(--surface-3)] border border-[var(--brand-border)] rounded px-3 py-2 break-all">
              {revealed.plaintextKeyOnceShown}
            </code>
            <Button variant="secondary" size="sm" onClick={handleCopy}>
              <span className="inline-flex items-center gap-1.5">
                <Icon as={copied ? Check : Copy} size="sm" className={copied ? 'text-emerald-400' : undefined} />
                {copied ? 'Copied' : 'Copy'}
              </span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRevealed(null)}>Done</Button>
          </div>
        </div>
      )}

      {/* Key list */}
      {isLoading ? (
        <div className="px-5 py-8 flex items-center justify-center gap-2 t-caption text-[var(--brand-text-muted)]">
          <Icon as={Loader2} size="md" className="animate-spin" /> Loading keys…
        </div>
      ) : isError ? (
        <div className="px-5 py-6 t-caption text-accent-danger space-y-1">
          <p className="font-medium">Failed to load MCP API keys</p>
          <p className="text-[var(--brand-text-muted)] font-mono break-all">{error instanceof Error ? error.message : String(error)}</p>
        </div>
      ) : keys.length === 0 ? (
        <div className="px-5 py-6">
          <EmptyState
            icon={KeyRound}
            title="No API keys yet"
            description="Create a per-workspace key above to let an MCP client act on a single workspace. The env master key still grants all-workspace access."
          />
        </div>
      ) : (
        <div className="divide-y divide-[var(--brand-border)]/60">
          {keys.map((k) => (
            <div key={k.id} className="px-5 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="t-caption text-[var(--brand-text)] truncate">{k.label}</span>
                  <span className="t-caption-sm text-[var(--brand-text-muted)] truncate">· {k.workspaceName}</span>
                </div>
                <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">
                  Created {formatDate(k.createdAt)} · Last used {formatDate(k.lastUsedAt)}
                </div>
              </div>

              <span
                className={`t-caption-sm px-1.5 py-0.5 rounded font-medium shrink-0 ${
                  k.revoked
                    ? 'bg-[var(--surface-3)] text-[var(--brand-text-muted)]'
                    : 'bg-emerald-500/10 text-emerald-400'
                }`}
              >
                {k.revoked ? 'Revoked' : 'Active'}
              </span>

              {k.revoked ? (
                <div className="w-5 shrink-0" />
              ) : (
                <IconButton
                  onClick={() => setPendingRevoke(k)}
                  disabled={isRevoking}
                  icon={Trash2}
                  label={`Revoke key ${k.label}`}
                  variant="ghost"
                  size="sm"
                  title="Revoke this key (rotation) — it stops authenticating immediately"
                  className="rounded hover:bg-white/5 disabled:opacity-50 shrink-0 text-[var(--brand-text-muted)] hover:text-accent-danger"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingRevoke !== null}
        title="Revoke API key?"
        message={pendingRevoke
          ? `"${pendingRevoke.label}" (${pendingRevoke.workspaceName}) will stop authenticating immediately. Any MCP client using it must be reissued a new key. This cannot be undone.`
          : ''}
        confirmLabel="Revoke key"
        variant="destructive"
        onConfirm={handleRevokeConfirmed}
        onCancel={() => setPendingRevoke(null)}
      />
    </section>
  );
}
