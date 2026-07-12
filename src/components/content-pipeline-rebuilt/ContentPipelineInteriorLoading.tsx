// @ds-rebuilt
import { LoadingState } from '../ui';

interface ContentPipelineInteriorLoadingProps {
  label: string;
  compact?: boolean;
}

export function ContentPipelineInteriorLoading({
  label,
  compact = false,
}: ContentPipelineInteriorLoadingProps) {
  return (
    <LoadingState
      message={`Loading ${label}…`}
      size={compact ? 'sm' : 'lg'}
      className={compact ? 'py-8' : 'py-16'}
    />
  );
}
