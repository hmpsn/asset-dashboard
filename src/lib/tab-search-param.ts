export interface ResolveTabSearchParamOptions<T extends string> {
  validValues: readonly T[];
  fallback: T;
  legacyAliases?: Partial<Record<string, T>>;
  normalizeResolved?: (value: T) => T;
}

export function isValidTabSearchParam<T extends string>(
  value: string | null,
  validValues: readonly T[],
): value is T {
  return value !== null && (validValues as readonly string[]).includes(value);
}

export function resolveTabSearchParam<T extends string>(
  param: string | null,
  {
    validValues,
    fallback,
    legacyAliases,
    normalizeResolved,
  }: ResolveTabSearchParamOptions<T>,
): T {
  const normalize = normalizeResolved ?? ((value: T) => value);

  if (isValidTabSearchParam(param, validValues)) return normalize(param);
  if (param && legacyAliases && legacyAliases[param]) return normalize(legacyAliases[param] as T);
  return normalize(fallback);
}

export function clearTabSearchParam(
  searchParams: URLSearchParams,
): URLSearchParams | null {
  if (!searchParams.has('tab')) return null;
  const next = new URLSearchParams(searchParams);
  next.delete('tab');
  return next;
}
