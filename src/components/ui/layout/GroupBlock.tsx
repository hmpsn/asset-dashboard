// @ds-rebuilt
import { useId, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';

export interface GroupStat {
  label: string;
  value: string | number;
  color?: string;
}

export interface GroupFlag {
  label: string;
  color?: string;
  bg?: string;
  border?: string;
}

/**
 * Cluster/group section: header (icon tile · title · sub-meta · right-aligned
 * stats or flag) over a body of rows, optionally collapsible. Use for keyword
 * clusters, page groups, brand personas — anywhere a section header must carry
 * its own metrics. For a plain titled section use `SectionCard`.
 */
export interface GroupBlockProps {
  icon?: LucideIcon;
  iconColor?: string;
  title: string;
  meta?: string;
  stats?: GroupStat[];
  flag?: GroupFlag;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Semantic heading level for the title. Default 'h3'. */
  headingLevel?: 'h2' | 'h3' | 'h4';
  children?: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function GroupBlock({
  icon: Icon,
  iconColor,
  title,
  meta,
  stats = [],
  flag,
  collapsible = false,
  defaultOpen = true,
  headingLevel = 'h3',
  children,
  className,
  id,
  style,
}: GroupBlockProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const Heading = headingLevel;
  // Always wire aria-controls ↔ body id, even when no `id` prop is passed
  // (review finding — a bare collapsible lost the disclosure→content link).
  const reactId = useId();
  const bodyId = `${id ?? reactId}-body`;

  const header = (
    <>
      {collapsible && (
        <ChevronDown
          aria-hidden="true"
          style={{
            width: 'var(--icon-sm)',
            height: 'var(--icon-sm)',
            color: 'var(--brand-text-dim)',
            transform: open ? 'none' : 'rotate(-90deg)',
            transition: 'transform var(--dur-fast) var(--ease-out)',
            flexShrink: 0,
          }}
        />
      )}
      {Icon && (
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon style={{ width: 16, height: 16, color: iconColor || 'var(--teal)' }} aria-hidden="true" />
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <Heading
          className="t-ui"
          style={{
            margin: 0,
            fontWeight: 600,
            color: 'var(--brand-text-bright)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </Heading>
        {meta && (
          <div className="t-caption-sm" style={{ color: 'var(--brand-text-muted)', marginTop: 1 }}>
            {meta}
          </div>
        )}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
        {stats.map((s, i) => (
          <div key={i} style={{ textAlign: 'right' }}>
            <div
              className="t-stat-sm"
              style={{
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 700,
                color: s.color || 'var(--brand-text-bright)',
                lineHeight: 1.1,
              }}
            >
              {s.value}
            </div>
            <div className="t-caption-sm" style={{ color: 'var(--brand-text-dim)' }}>
              {s.label}
            </div>
          </div>
        ))}
        {flag && (
          <span
            className="t-caption-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontWeight: 600,
              color: flag.color || 'var(--orange)',
              background: flag.bg || 'color-mix(in srgb, var(--orange) 10%, transparent)',
              border: `1px solid ${flag.border || 'color-mix(in srgb, var(--orange) 28%, transparent)'}`,
              borderRadius: 'var(--radius-pill)',
              padding: '3px 10px',
              whiteSpace: 'nowrap',
            }}
          >
            {flag.label}
          </span>
        )}
      </div>
    </>
  );

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '13px 16px',
    background: 'var(--surface-1)',
    // Per-side border longhands instead of the `border: 'none'` shorthand: toggling
    // `borderBottom` while the all-sides `border` shorthand was also set triggered
    // React's "conflicting property" dev warning on every re-render (GroupBlock renders
    // once per grouped-lens block, so it fired in bulk). `borderTop/Right/Left: 'none'`
    // is pixel-identical to the old `border: 'none'` (both zero those sides' width AND
    // style) but shares no shorthand ancestor with `borderBottom`, so no warning.
    borderTop: 'none',
    borderRight: 'none',
    borderLeft: 'none',
    borderBottom: open ? '1px solid var(--brand-border)' : 'none',
    width: '100%',
    textAlign: 'left',
    font: 'inherit',
    cursor: collapsible ? 'pointer' : 'default',
  };

  return (
    <div
      id={id}
      className={className}
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--brand-border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          style={headerStyle}
        >
          {header}
        </button>
      ) : (
        <div style={headerStyle}>{header}</div>
      )}
      {open && (
        <div id={bodyId} style={{ padding: '6px 8px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
