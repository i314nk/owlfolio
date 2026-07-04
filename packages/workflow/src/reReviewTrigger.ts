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
  input: { ticker: string; research_case_id: string; source_ledger_path: string },
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

  // Weighted candidates = interim + proxy filings; annual filings feed only the honesty flag.
  const candidates: WeightedNewFiling[] = [
    ...(fundamentals.recent_filings ?? []),
    ...(fundamentals.proxy_filings ?? []),
  ].flatMap((filing) => {
    const weight = filingFormWeight(filing.form)
    return weight === undefined ? [] : [{ ...filing, weight }]
  })

  const new_filings = (selectFilingsNotInCorpus(candidates, corpus) as WeightedNewFiling[])
    .sort((a, b) => WEIGHT_ORDER[a.weight] - WEIGHT_ORDER[b.weight]
      || (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0))

  const newAnnual = selectFilingsNotInCorpus(fundamentals.filings ?? [], corpus)[0]

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
