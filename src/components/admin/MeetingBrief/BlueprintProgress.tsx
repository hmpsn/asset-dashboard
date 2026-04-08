interface Props {
  progress: string | null;
}

export function BlueprintProgress({ progress }: Props) {
  if (!progress) return null;
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Blueprint Progress
      </h3>
      <p className="text-sm text-zinc-200 leading-relaxed">{progress}</p>
    </div>
  );
}
