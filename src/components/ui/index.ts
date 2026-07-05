export { MetricRing, MetricRingSvg } from './MetricRing';
export { MetricToggleCard } from './MetricToggleCard';
export { StatCard, CompactStatBar, cardToneClasses } from './StatCard';
export { PageHeader } from './PageHeader';
export { SectionCard } from './SectionCard';
export { DateRangeSelector } from './DateRangeSelector';
export { DataList } from './DataList';
export { Badge } from './Badge';
export type { BadgeTone, BadgeVariant, BadgeSize, BadgeShape } from './Badge';
export { StatusBadge } from './StatusBadge';
export type { StatusBadgeDomain, StatusBadgeConfig } from './statusConfig';
export { CharacterCounter } from './CharacterCounter';
export { FreshnessStamp, type FreshnessStampProps } from './FreshnessStamp';
export { SerpPreview } from './SerpPreview';
export { SocialPreview } from './SocialPreview';
export { EmptyState } from './EmptyState';
export { InlineBanner, type InlineBannerTone, type InlineBannerSize } from './InlineBanner';
export { LoadingState, Skeleton as LoadingSkeleton, TableSkeleton } from './LoadingState';
export { ErrorState, NetworkError, DataError, PermissionError } from './ErrorState';
export { NextStepsCard } from './NextStepsCard';
export { ProgressIndicator } from './ProgressIndicator';
export { TabBar } from './TabBar';
export { TierGate, TierBadge, tierAtLeast, type Tier } from './TierGate';
export { AIContextIndicator } from './AIContextIndicator';
export { ScannerReveal } from './ScannerReveal';
export { Skeleton, StatCardSkeleton, SectionCardSkeleton, OverviewSkeleton, AnalyticsSkeleton } from './Skeleton';
export {
  scoreColor,
  scoreColorClass,
  scoreBgClass,
  scoreBgBarClass,
  aeoScoreColorClass,
  aeoScoreBgBarClass,
  positionColor,
  positionTone,
  DATE_PRESETS_SHORT,
  DATE_PRESETS_FULL,
  DATE_PRESETS_SEARCH,
  themeColor,
  chartGridColor,
  chartAxisColor,
  chartDotStroke,
  chartDotFill,
  chartTooltipStyle,
  chartTooltipLabelStyle,
} from './constants';
export { OnboardingChecklist } from './OnboardingChecklist';
export type { OnboardingStep, OnboardingChecklistProps } from './OnboardingChecklist';
export { WorkflowStepper } from './WorkflowStepper';
export type { WorkflowStep, WorkflowStepperProps } from './WorkflowStepper';
export { WorkspaceHealthBar } from './WorkspaceHealthBar';
export type { HealthMetric, WorkspaceHealthBarProps } from './WorkspaceHealthBar';
export { ConfirmDialog } from './ConfirmDialog';
export { TrendBadge, type TrendBadgeProps } from './TrendBadge';
export { OutcomeReadbackChip, type OutcomeReadbackChipProps } from './OutcomeReadbackChip';
export { ChartCard, type ChartCardProps } from './ChartCard';

// ─── F3 — net-new design-system primitives ───────────────────────────────────
export { Avatar } from './Avatar';
export type { AvatarProps } from './Avatar';
export { IntentTag, INTENT_TONE, INTENT_ABBREV, type KeywordIntent } from './IntentTag';
export type { IntentTagProps } from './IntentTag';
export { DataTable } from './DataTable';
export type { DataTableProps, DataColumn } from './DataTable';
export { MetricTile } from './MetricTile';
export type { MetricTileProps } from './MetricTile';
export { Sparkline } from './Sparkline';
export type { SparklineProps } from './Sparkline';
export { Meter } from './Meter';
export type { MeterProps } from './Meter';
export { KeyValueRow, DefinitionList } from './KeyValueRow';
export type { KeyValueRowProps, DefinitionListProps, DefinitionItem } from './KeyValueRow';
export { BoardColumn, BoardCard } from './BoardColumn';
export type { BoardColumnProps, BoardCardProps } from './BoardColumn';
export { useRovingTabindex } from './useRovingTabindex';
export type {
  RovingTabindex,
  RovingTabindexOptions,
  RovingItemProps,
  RovingOrientation,
} from './useRovingTabindex';

// ─── Phase 1 primitives (pre-committed stubs; Phase 1 agents fill implementations) ───

// Typography
export { Heading, Stat, BodyText, Caption, Label, Mono } from './typography';

// Icon
export { Icon } from './Icon';
export type { IconSize, IconProps } from './Icon';
export { ICON_NAMES, type IconName } from './iconNames';

// Actions
export { Button } from './Button';
export { IconButton } from './IconButton';
export { ClickableRow } from './ClickableRow';

// Forms
export { FormField, FormInput, FormSelect, FormTextarea, Checkbox, Toggle } from './forms';
export type { FormFieldProps, FormFieldContextValue } from './forms/FormField';
export type { FormInputProps } from './forms/FormInput';
export type { FormSelectProps, SelectOption } from './forms/FormSelect';
export type { FormTextareaProps } from './forms/FormTextarea';
export type { CheckboxProps } from './forms/Checkbox';
export type { ToggleProps } from './forms/Toggle';
// F3 net-new forms
export { Segmented, LensSwitcher, FilterChip, SearchField, RadioGroup } from './forms';
export type {
  SegmentedProps,
  LensSwitcherProps, LensOption,
  FilterChipProps,
  SearchFieldProps,
  RadioGroupProps, RadioOption,
} from './forms';

// Layout
export { Row, Stack, Column, Grid, Divider } from './layout';
export type {
  RowProps, GapSize, RowAlign, RowJustify,
  StackProps, StackDir, StackAlign,
  ColumnProps,
  GridProps, GridCols, GridColCount,
  DividerProps, DividerOrientation,
} from './layout';
// F3 net-new layout
export { AppShell, PageContainer, Toolbar, ToolbarSpacer, GroupBlock, NavItem, NavGroup } from './layout';
export type {
  AppShellProps,
  PageContainerProps,
  ToolbarProps,
  GroupBlockProps, GroupStat, GroupFlag,
  NavItemProps,
  NavGroupProps,
} from './layout';

// Overlays
export { Modal, Popover, Tooltip } from './overlay';
// F3 net-new overlay + shared machinery
export { Drawer } from './overlay';
export type { DrawerProps } from './overlay';
export { getFocusable, acquireScrollLock, releaseScrollLock, FOCUSABLE_SELECTOR } from './overlay';
export { Menu } from './Menu';
export type { MenuItem, MenuProps } from './Menu';

// Flow / attention, disclosure, section header (design cleanup Wave 0)
export { NeedsAttention } from './NeedsAttention';
export type { NeedsAttentionProps, AttentionItem, AttentionSeverity } from './NeedsAttention';
export { Disclosure } from './Disclosure';
export type { DisclosureProps } from './Disclosure';
export { SectionLabel } from './SectionLabel';

// className merge helper — re-exported so Phase 2 consumers can write
// `import { cn } from '../ui'` alongside the primitives they're using
// (per playbook §6.1). The canonical implementation lives in
// `src/lib/utils.ts`; ui primitives import from there directly to avoid a
// circular dependency through this barrel.
export { cn } from '../../lib/utils';
