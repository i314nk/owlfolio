// Re-review TRIGGER (Phase 1, callable — the freshness layer): is there a new material filing for a
// thesis-holding name, not yet in the corpus the decision stood on? Computed as the diff between
// discovery-now (the SEC submissions index via fetchCompanyFundamentals) and the PERSISTED source-ledger
// corpus at last synthesis (sourceLedgerRead). Not an agent — a check. The caller (an on-demand web
// action today; a scheduler firing the worker task-kind later) decides what to do with the answer.
//
// Filing-type → trigger strength: an 8-K/6-K is an EVENT by nature (its appearance IS the "something
// happened, re-check" signal) → strong; a 10-Q is periodic/expected → medium; a DEF 14A is an annual
// governance refresh → weak. No 8-K item-code parsing in v1 (deliberate coarseness). A NEW ANNUAL
// filing (10-K/20-F/40-F) is surfaced as an honesty flag, never weighted: the annual supersession
// re-run is the right tool there, not a re-review.

import { fetchCompanyFundamentals, type FilingRef, type Fundamentals, type SecEdgarDeps } from './secEdgar'
import { bundleToReadCorpus, readSourceLedgerBundle, selectFilingsNotInCorpus } from './sourceLedgerRead'

export type FilingTriggerWeight = 'strong' | 'medium' | 'weak'

/**
 * Pure form → trigger-strength mapping. 8-K/6-K (+ amendments) → strong; 10-Q (+/A) → medium;
 * DEF 14A → weak. Anything else (annual forms, ownership forms, junk) → undefined = excluded from
 * the trigger entirely.
 */
export function filingFormWeight(form: string): FilingTriggerWeight | undefined {
  if (form === '8-K' || form === '8-K/A' || form === '6-K' || form === '6-K/A') return 'strong'
  if (form === '10-Q' || form === '10-Q/A') return 'medium'
  if (form === 'DEF 14A') return 'weak'
  return undefined
}

/**
 * 8-K item codes that are UNSCHEDULED thesis-break events — the appearance of any one IS the
 * "something happened, re-check" signal (the design doc's strong class):
 *   1.01/1.02 material agreement entry/termination · 1.03 bankruptcy · 2.01 acquisition/disposition
 *   completed · 2.05 exit/disposal costs · 2.06 material impairment · 3.01 delisting notice ·
 *   4.01 auditor change · 4.02 non-reliance on prior financials (restatement) · 5.01 change in
 *   control · 5.02 director/officer departure or appointment.
 * Everything else is SCHEDULED or AMBIGUOUS → medium (visible, never worker auto-spend): 2.02 results
 * of operations (the quarterly earnings announcement — "scheduled freshness", like a 10-Q), 7.01 Reg
 * FD, 8.01 other events (a catch-all: dividends AND litigation land here — unreadable without the
 * document, so it stays visible at medium and the model reads it when a re-review runs), 5.03/5.07
 * governance, 9.01 exhibits.
 */
const EIGHT_K_STRONG_ITEMS = new Set(['1.01', '1.02', '1.03', '2.01', '2.05', '2.06', '3.01', '4.01', '4.02', '5.01', '5.02'])

/**
 * Weight an 8-K by its EDGAR item codes ('2.02,9.01'). Max wins across items. FAIL TOWARD ATTENTION:
 * missing or unparseable item metadata → strong (the v1 behavior) — a mis-weighted routine filing
 * costs one bounded re-review; a silently demoted impairment costs a thesis.
 */
export function eightKItemWeight(items: string | undefined): FilingTriggerWeight {
  if (items === undefined) return 'strong'
  const codes = items.split(',').map((code) => code.trim()).filter((code) => /^\d{1,2}\.\d{2}$/.test(code))
  if (codes.length === 0) return 'strong'
  return codes.some((code) => EIGHT_K_STRONG_ITEMS.has(code)) ? 'strong' : 'medium'
}

export type WeightedNewFiling = FilingRef & { weight: FilingTriggerWeight }

export type NewFilingsCheck = {
  ticker: string
  research_case_id: string
  /** Ordered strong → medium → weak; newest-first within a weight. Empty when no_prior_corpus. */
  new_filings: WeightedNewFiling[]
  strongest_trigger?: FilingTriggerWeight
  prior_corpus_size: number
  /**
   * FAIL-CLOSED marker: no persisted source-ledger bundle exists for this case, so a "new since the
   * decision" delta is NOT computable. new_filings is [] in this state — claiming every filing is new
   * against a case that merely predates ledger persistence would fire strong triggers on every legacy
   * case. The honest refresh for a no-corpus case is a full re-run, not a fabricated delta.
   */
  no_prior_corpus: boolean
  /**
   * Honesty flag: a NEW ANNUAL filing (10-K/20-F/40-F) not in the corpus — the annual supersession
   * re-run is due; re-review is the wrong tool. Surfaced, never weighted into new_filings.
   */
  new_annual_filing?: FilingRef
  checked_at: string
}

export type CheckForNewFilingsDeps = {
  /** Injectable EDGAR resolver (tests). Defaults to the live fetchCompanyFundamentals. */
  fetchFundamentals?: (ticker: string, deps?: SecEdgarDeps) => Promise<Fundamentals | undefined>
  secEdgar?: SecEdgarDeps
  now?: () => string
}

const WEIGHT_ORDER: Record<FilingTriggerWeight, number> = { strong: 0, medium: 1, weak: 2 }

/**
 * The re-review trigger: which filings exist now that were NOT in the persisted corpus the case's
 * decision stood on? Fail-closed twice over: unresolvable fundamentals → `undefined` (no claim either
 * way); missing bundle → `no_prior_corpus: true` with an EMPTY delta. Pure apart from the EDGAR fetch
 * and the bundle read; never grounds or spends provider calls — the caller decides what a trigger is
 * worth.
 */
export async function checkForNewFilings(
  input: {
    ticker: string
    research_case_id: string
    source_ledger_path: string
    /**
     * The decision/last-synthesis timestamp (ISO). Filings filed before this DATE are excluded —
     * without it, a company's entire UNREAD filing history looks "new" (the corpus only holds what the
     * run read). Date-granular and inclusive on the decision day: a same-day filing may have landed
     * after synthesis, and the corpus diff already drops anything actually read.
     */
    since?: string
  },
  deps?: CheckForNewFilingsDeps,
): Promise<NewFilingsCheck | undefined> {
  const fetchFundamentals = deps?.fetchFundamentals ?? fetchCompanyFundamentals
  const now = deps?.now ?? (() => new Date().toISOString())

  const fundamentals = await fetchFundamentals(input.ticker, deps?.secEdgar)
  if (fundamentals === undefined) return undefined

  // readSourceLedgerBundle (not loadPersistedReadCorpus) so a MISSING bundle is distinguishable from
  // an empty corpus — the two demand different honesty (see no_prior_corpus).
  const bundle = await readSourceLedgerBundle({
    source_ledger_path: input.source_ledger_path,
    research_case_id: input.research_case_id,
  })
  const checked_at = now()
  if (bundle === undefined) {
    return {
      ticker: input.ticker,
      research_case_id: input.research_case_id,
      new_filings: [],
      prior_corpus_size: 0,
      no_prior_corpus: true,
      checked_at,
    }
  }
  const corpus = bundleToReadCorpus(bundle)

  // Date bound: keep only filings filed ON or AFTER the decision date (date-granular, inclusive).
  const sinceDate = input.since?.slice(0, 10)
  const filedSince = (filing: FilingRef) => sinceDate === undefined || filing.filed >= sinceDate

  // Weighted candidates = interim + proxy filings; annual filings feed only the honesty flag.
  // An 8-K with item-code metadata takes its ITEM weight (v2): routine earnings/dividend 8-Ks demote
  // to medium; unscheduled thesis-break items (and missing metadata) stay strong.
  const candidates: WeightedNewFiling[] = [
    ...(fundamentals.recent_filings ?? []),
    ...(fundamentals.proxy_filings ?? []),
  ].filter(filedSince).flatMap((filing) => {
    const formWeight = filingFormWeight(filing.form)
    if (formWeight === undefined) return []
    const weight = formWeight === 'strong' && (filing.form === '8-K' || filing.form === '8-K/A')
      ? eightKItemWeight(filing.items)
      : formWeight
    return [{ ...filing, weight }]
  })

  const new_filings = (selectFilingsNotInCorpus(candidates, corpus) as WeightedNewFiling[])
    .sort((a, b) => WEIGHT_ORDER[a.weight] - WEIGHT_ORDER[b.weight]
      || (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0))

  const newAnnual = selectFilingsNotInCorpus((fundamentals.filings ?? []).filter(filedSince), corpus)[0]

  return {
    ticker: input.ticker,
    research_case_id: input.research_case_id,
    new_filings,
    ...(new_filings.length > 0 ? { strongest_trigger: new_filings[0]!.weight } : {}),
    prior_corpus_size: corpus.size,
    no_prior_corpus: false,
    ...(newAnnual === undefined ? {} : { new_annual_filing: newAnnual }),
    checked_at,
  }
}
