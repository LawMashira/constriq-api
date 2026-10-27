export const ORIGINAL_FORECAST_REASON = 'Uncommitted remaining cost from the original estimate';

export const BOQ_REMAINING_FORECAST_REASON =
  'Remaining cost assumed equal to the imported cost rates until a forecast is posted';

export const AUTO_REMAINING_FORECAST_REASONS = [
  ORIGINAL_FORECAST_REASON,
  BOQ_REMAINING_FORECAST_REASON,
] as const;

export const LUMP_COST_CODES = new Set(['GEN', 'OTH']);

export function isLumpCostCode(code: string) {
  return LUMP_COST_CODES.has(code);
}

/** BOQ remaining plus a GEN/OTH original estimate is the same remaining cost counted twice. */
export function duplicateLumpRemainingPostingIds(
  remainingForecasts: Array<{
    financialPostingId: string | null;
    costCode: { code: string };
  }>,
) {
  const hasStructured = remainingForecasts.some((row) => !isLumpCostCode(row.costCode.code));
  if (!hasStructured) {
    return new Set<string>();
  }
  return new Set(
    remainingForecasts
      .filter((row) => isLumpCostCode(row.costCode.code) && row.financialPostingId)
      .map((row) => row.financialPostingId as string),
  );
}
