/**
 * AddRecommendationModal — The Issue operator-steering verb 2 (spec §12): add a rec the system
 * missed. An operator-authored recommendation minted server-side with `source: 'manual:<id>'`,
 * `clientStatus: 'system'`, `lifecycle: 'active'`, `status: 'pending'` — durable across the weekly
 * regen via the operator-minted retention branch (Lane B).
 *
 * Built on the shared `<Modal>` overlay primitive (focus trap, escape, scroll lock, ARIA, backdrop
 * click) composing the Form* primitives. Type list = MANUAL_REC_ALLOWED_TYPES (every RecType except
 * cannibalization, which needs a urlSetKey). Title + insight are required; priority defaults to
 * fix_soon.
 *
 * Tokens: src/tokens.css only. Color law: teal=action, NO purple. Mounts under the
 * strategy-the-issue flag (parent gates) — byte-identical OFF.
 */
import { useEffect, useState } from 'react';
import { Button, Modal, FormField, FormInput, FormSelect, FormTextarea } from '../../ui';
import {
  MANUAL_REC_ALLOWED_TYPES,
  REC_WORDING_TITLE_MAX,
  REC_WORDING_INSIGHT_MAX,
  type ManualRecType,
  type CreateManualRecPayload,
} from '../../../../shared/types/rec-operator-steering';
import type { RecPriority } from '../../../../shared/types/recommendations';

interface AddRecommendationModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: CreateManualRecPayload) => void;
  isPending?: boolean;
}

// Human labels for the allowed rec types (the FormSelect options).
const TYPE_LABELS: Record<ManualRecType, string> = {
  content: 'Content',
  content_refresh: 'Content refresh',
  keyword_gap: 'Keyword gap',
  topic_cluster: 'Topic cluster',
  technical: 'Technical',
  metadata: 'Metadata',
  schema: 'Schema',
  performance: 'Performance',
  accessibility: 'Accessibility',
  strategy: 'Strategy',
  aeo: 'Answer engine (AEO)',
  local_visibility: 'Local visibility',
  local_service_gap: 'Local service gap',
  competitor: 'Competitor',
};

const TYPE_OPTIONS = MANUAL_REC_ALLOWED_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }));

const PRIORITY_OPTIONS: { value: RecPriority; label: string }[] = [
  { value: 'fix_now', label: 'Fix now' },
  { value: 'fix_soon', label: 'Fix soon' },
  { value: 'fix_later', label: 'Fix later' },
  { value: 'ongoing', label: 'Ongoing' },
];

export function AddRecommendationModal({
  open,
  onClose,
  onCreate,
  isPending = false,
}: AddRecommendationModalProps) {
  const [type, setType] = useState<ManualRecType>('content');
  const [title, setTitle] = useState('');
  const [insight, setInsight] = useState('');
  const [priority, setPriority] = useState<RecPriority>('fix_soon');
  const [targetKeyword, setTargetKeyword] = useState('');

  // Reset the form whenever the modal (re)opens so a prior draft never bleeds into the next add.
  useEffect(() => {
    if (open) {
      setType('content');
      setTitle('');
      setInsight('');
      setPriority('fix_soon');
      setTargetKeyword('');
    }
  }, [open]);

  const canSubmit = title.trim().length > 0 && insight.trim().length > 0 && !isPending;

  const submit = () => {
    if (!canSubmit) return;
    const payload: CreateManualRecPayload = {
      type,
      title: title.trim(),
      insight: insight.trim(),
      priority,
    };
    const kw = targetKeyword.trim();
    if (kw) payload.targetKeyword = kw;
    onCreate(payload);
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <Modal.Header title="Add a recommendation" onClose={onClose} />
      <Modal.Body>
        <p className="t-caption-sm text-[var(--brand-text-muted)] mb-5">
          Mint a move the system missed. It joins the curation queue and survives the weekly regen
          until you strike it.
        </p>

        <div className="space-y-4">
          <FormField label="Type">
            <FormSelect value={type} onChange={(v) => setType(v as ManualRecType)} options={TYPE_OPTIONS} />
          </FormField>

          <FormField label="Title">
            <FormInput
              value={title}
              onChange={setTitle}
              maxLength={REC_WORDING_TITLE_MAX}
              placeholder="What should we do?"
            />
          </FormField>

          <FormField label="Insight">
            <FormTextarea
              value={insight}
              onChange={setInsight}
              maxLength={REC_WORDING_INSIGHT_MAX}
              rows={3}
              placeholder="Why it matters."
            />
          </FormField>

          <FormField label="Priority">
            <FormSelect
              value={priority}
              onChange={(v) => setPriority(v as RecPriority)}
              options={PRIORITY_OPTIONS}
            />
          </FormField>

          <FormField label="Target keyword (optional)">
            <FormInput
              value={targetKeyword}
              onChange={setTargetKeyword}
              placeholder="e.g. seo audit tool"
            />
          </FormField>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button onClick={onClose} variant="secondary" size="md" disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={submit} variant="primary" size="md" disabled={!canSubmit} loading={isPending}>
          Add recommendation
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
