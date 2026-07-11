/**
 * Phase 2 V3 (owner-validated option A, 2026-07-11) — curated ADR ratios for foreign filers.
 *
 * ordinary shares per ONE US-listed ADR/share. The T0 foreign-filer FX conversion multiplies the
 * reporting-currency owner earnings PER ORDINARY SHARE by this ratio (then by the FX rate) to get the
 * per-LISTED-share basis the USD price is quoted against. There is NO deterministic machine source for
 * ADR ratios (they live in F-6/depositary documents, not structured EDGAR data), so:
 *   - a ticker ABSENT from this map defaults to 1 with a VISIBLE `adr_ratio_assumed` degraded flag
 *     (never silent — the owner curates an entry when the assumption is wrong);
 *   - entries here are OWNER-CURATED facts (add the source in a comment when adding one).
 * The model is never asked for the ratio ("code computes, judgment proposes").
 */
export const ADR_ORDINARY_SHARES_PER_LISTED: Readonly<Record<string, number>> = Object.freeze({
  // (owner-curated; empty by default — assumed-1 runs surface the adr_ratio_assumed flag)
})

/** Resolve the curated ratio for a ticker (undefined = not curated → the caller assumes 1 + flags). */
export function curatedAdrRatio(ticker: string): number | undefined {
  return ADR_ORDINARY_SHARES_PER_LISTED[ticker.toUpperCase()]
}
