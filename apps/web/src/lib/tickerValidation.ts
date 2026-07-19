import { resolveCik } from '@owlfolio/workflow/secEdgar'

/**
 * TICKER VALIDATION (owner, 2026-07-19): before a research case is minted, the user-typed ticker is
 * checked against SEC's official filer list (company_tickers.json via resolveCik) — the SAME universe
 * every gate and lane grounds in. A ticker with no CIK is not merely "possibly mistyped": it is a
 * company this pipeline cannot research at all, so rejecting it up front saves a spawned worker, any
 * provider spend, and a permanently-failed case on the Faults board.
 *
 * Semantics:
 *  - 'ok'         → the (normalized, uppercased) ticker resolves; the run proceeds with THIS form.
 *  - 'unknown'    → no SEC filer matches (the exact form or the dot→hyphen variant) — hard 400.
 *  - 'unverified' → the LOOKUP failed (SEC unreachable): FAIL-OPEN and proceed — the run's own
 *                   grounding still fails closed, and a sec.gov hiccup must not block all research.
 *
 * Normalization: humans type class shares with a dot (BRK.B); EDGAR lists them with a hyphen
 * (BRK-B). The exact uppercased form is tried first, then the hyphen variant — accepted silently.
 */

export type ResearchTickerResolution =
  | { status: 'ok'; ticker: string }
  | { status: 'unknown' }
  | { status: 'unverified'; ticker: string }

type Deps = { resolveCik?: (ticker: string) => Promise<string | undefined> }

export async function resolveResearchTicker(rawTicker: string, deps: Deps = {}): Promise<ResearchTickerResolution> {
  const lookup = deps.resolveCik ?? ((ticker: string) => resolveCik(ticker))
  const exact = rawTicker.trim().toUpperCase()
  const candidates = exact.includes('.') ? [exact, exact.replace(/\./g, '-')] : [exact]

  try {
    for (const candidate of candidates) {
      if (await lookup(candidate) !== undefined) {
        return { status: 'ok', ticker: candidate }
      }
    }
    return { status: 'unknown' }
  } catch {
    return { status: 'unverified', ticker: exact }
  }
}
