interface RefetchResult {
  error: unknown | null;
}

/**
 * React Query's `refetch()` resolves with an error result by default instead of
 * rejecting. Manual refresh controls must inspect those results before showing
 * success feedback.
 */
export async function awaitSuccessfulRefetches(
  refetches: ReadonlyArray<PromiseLike<RefetchResult>>,
): Promise<void> {
  const results = await Promise.all(refetches);
  const failed = results.find((result) => result.error !== null && result.error !== undefined);
  if (failed) throw failed.error;
}
