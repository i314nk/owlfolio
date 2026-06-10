// Versioned per-lane SOURCE DISCIPLINE policy — judgment-objectivity-layer-spec Mechanism 6
// ("starve the narrative"). A model fed the consensus narrative returns the consensus dressed as
// analysis; classification lanes therefore reason from PRIMARY documents only. This config is the
// SINGLE source of truth for (a) the URL→category classifier heuristics and (b) the per-lane
// allow/exclude whitelist enforced in the harness grounding fetcher (sourceGrounding.ts).
//
// Mirrors the versioned-config pattern of valuationParams.ts / judgmentRubrics.ts (a frozen typed
// object + a `version` field). Changing the whitelist is a deliberate, logged act — bump `version`.
//
// The whitelist is an ADDITIONAL gate on top of grounding (sha256 + SSRF + verified_ids), never a
// bypass: an excluded source is rejected and RECORDED (visible), never silently dropped.

/**
 * Source categories the classifier maps a URL to. Primary-document categories first, then the
 * narrative categories the classification lanes EXCLUDE, then `unknown` (treated conservatively).
 */
export type SourceCategory =
  | 'filing' // SEC/EDGAR filings, 10-K/20-F/40-F/8-K, company filing PDFs
  | 'transcript' // earnings-call transcripts
  | 'regulatory_statistical' // regulators + statistical agencies (BLS, Fed, SEC rulemaking, .gov data)
  | 'company_disclosure' // the company's own IR site / press releases
  | 'proxy' // DEF 14A proxy statements
  | 'insider_data' // Form 3/4/5 / insider-trading data
  | 'screening_provider' // Shariah screening providers (cross-check)
  | 'sell_side' // broker / sell-side analyst research
  | 'financial_media' // Bloomberg / Reuters / WSJ / CNBC / general news
  | 'investor_writeup' // Seeking Alpha / Substack / blogs / forum write-ups
  | 'unknown' // unrecognized — treated conservatively per the policy

export type LaneSourcePolicy = {
  /** Categories admitted for this lane. */
  allow: readonly SourceCategory[]
  /** Categories rejected for this lane (recorded as `excluded_by_lane_policy:<category>`). */
  exclude: readonly SourceCategory[]
  /**
   * Whether `unknown` is admitted. RISKS = true (consensus IS the job); classification lanes = false
   * (conservative — reason from primary documents only; a starved lane should fail-closed/degrade,
   * not fabricate). Recorded as `excluded_unknown_source` when rejected.
   */
  allow_unknown: boolean
}

export type SourcePolicy = {
  /** Monotonic version string. Bump on any whitelist change; pairs with a logged config event. */
  version: string
  /** Per-lane policy keyed by the swarm lane id (business_quality | moat | management | ...). */
  lanes: Readonly<Record<string, LaneSourcePolicy>>
  /**
   * Fallback policy for an unrecognized lane id — the CONSERVATIVE classification policy (NOT
   * allow-all). A new lane added without a policy entry fails closed onto primary documents.
   */
  default: LaneSourcePolicy
}

// The four primary-document categories every classification lane admits (spec table row 1).
const PRIMARY_DOCS: readonly SourceCategory[] = [
  'filing',
  'transcript',
  'regulatory_statistical',
  'company_disclosure',
]

// The narrative categories the classification lanes EXCLUDE (spec table: sell-side research,
// financial media, investor write-ups, blogs).
const NARRATIVE: readonly SourceCategory[] = ['sell_side', 'financial_media', 'investor_writeup']

// Classification lanes (MOAT/FINANCIAL_QUALITY/VALUATION/BUSINESS_QUALITY): primary docs only.
const CLASSIFICATION_POLICY: LaneSourcePolicy = {
  allow: PRIMARY_DOCS,
  exclude: NARRATIVE,
  allow_unknown: false,
}

/**
 * The frozen DEFAULT per-lane source policy (spec Mechanism 6 table). Bump `version` on any change.
 */
export const SOURCE_POLICY: SourcePolicy = Object.freeze({
  version: 'source-policy-2026-06-mechanism-6-v1',
  lanes: {
    business_quality: CLASSIFICATION_POLICY,
    moat: CLASSIFICATION_POLICY,
    financial_quality: CLASSIFICATION_POLICY,
    valuation: CLASSIFICATION_POLICY,
    // MANAGEMENT: filings, proxies, transcripts, insider-trading data; EXCLUDE media profiles.
    management: {
      allow: ['filing', 'transcript', 'proxy', 'insider_data'],
      exclude: ['sell_side', 'financial_media', 'investor_writeup'],
      allow_unknown: false,
    },
    // RISKS: everything (knowing the consensus IS the job).
    risks: {
      allow: [
        'filing', 'transcript', 'regulatory_statistical', 'company_disclosure', 'proxy',
        'insider_data', 'screening_provider', 'sell_side', 'financial_media', 'investor_writeup',
      ],
      exclude: [],
      allow_unknown: true,
    },
    // SHARIAH: filings, segment data (filings/company disclosure), screening providers as cross-check.
    shariah: {
      allow: ['filing', 'company_disclosure', 'regulatory_statistical', 'screening_provider'],
      exclude: ['sell_side', 'financial_media', 'investor_writeup'],
      allow_unknown: false,
    },
  },
  default: CLASSIFICATION_POLICY,
}) as SourcePolicy

// ---------------------------------------------------------------------------
// URL → category classifier (deterministic, pure)
// ---------------------------------------------------------------------------

// Known sell-side / broker research hosts (extend deliberately).
const SELL_SIDE_HOSTS = [
  'research.morganstanley.com', 'goldmansachs.com', 'ml.com', 'jpmorgan.com',
  'citivelocity.com', 'ubs.com', 'barclays.com', 'morningstar.com',
]
// Known financial-media hosts.
const FINANCIAL_MEDIA_HOSTS = [
  'bloomberg.com', 'reuters.com', 'wsj.com', 'cnbc.com', 'ft.com', 'marketwatch.com',
  'forbes.com', 'businessinsider.com', 'barrons.com', 'fool.com', 'yahoo.com', 'finance.yahoo.com',
  'investing.com', 'thestreet.com', 'nytimes.com',
]
// Known investor-write-up / blog hosts.
const INVESTOR_WRITEUP_HOSTS = ['seekingalpha.com', 'valueinvestorsclub.com', 'gurufocus.com']
// Known Shariah screening providers.
const SCREENING_PROVIDER_HOSTS = ['zoya.finance', 'islamicly.com', 'musaffa.com', 'idealratings.com']
// Statistical / regulatory agencies (in addition to the generic .gov heuristic below).
const REGULATORY_STATISTICAL_HOSTS = [
  'bls.gov', 'federalreserve.gov', 'bea.gov', 'census.gov', 'eia.gov', 'imf.org',
  'worldbank.org', 'oecd.org', 'ecb.europa.eu',
]

function hostMatches(host: string, candidates: readonly string[]): boolean {
  return candidates.some((c) => host === c || host.endsWith(`.${c}`))
}

/**
 * Deterministic, pure URL→category classifier (spec Mechanism 6). Uses domain + path heuristics; an
 * unrecognized source is `unknown` (treated conservatively by the policy). Heuristics, in priority
 * order:
 *   1. sec.gov / EDGAR — a FILING by default, but a DEF 14A path → proxy, a Form 4 / type=4 path →
 *      insider_data (more specific filing kinds win).
 *   2. earnings-call transcript path → transcript.
 *   3. known sell-side / media / investor-writeup / screening-provider / regulatory hosts.
 *   4. blog/substack hosts → investor_writeup.
 *   5. generic *.gov → regulatory_statistical.
 *   6. company IR / press / investor-relations paths → company_disclosure.
 *   7. otherwise unknown.
 */
export function classifySourceCategory(rawUrl: string): SourceCategory {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'unknown'
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const path = url.pathname.toLowerCase()
  const query = url.search.toLowerCase()
  const full = `${path}${query}`

  // 1. SEC / EDGAR — filing family. More-specific filing kinds win over the generic filing label.
  const isSec = host === 'sec.gov' || host.endsWith('.sec.gov') || full.includes('edgar')
  if (isSec) {
    if (/def[\s_-]?14a|proxy[\s_-]?statement|\/proxy/.test(full)) return 'proxy'
    if (/form[\s_-]?4|type=4|insider/.test(full)) return 'insider_data'
    return 'filing'
  }

  // 2. Earnings-call transcripts (path heuristic — applies before host buckets so a media-hosted
  //    transcript still classifies as a transcript primary doc).
  if (/transcript|earnings[\s_-]?call/.test(full)) return 'transcript'

  // 3. Known host buckets.
  if (hostMatches(host, SELL_SIDE_HOSTS)) return 'sell_side'
  if (hostMatches(host, SCREENING_PROVIDER_HOSTS)) return 'screening_provider'
  if (hostMatches(host, REGULATORY_STATISTICAL_HOSTS)) return 'regulatory_statistical'
  if (hostMatches(host, INVESTOR_WRITEUP_HOSTS)) return 'investor_writeup'
  if (hostMatches(host, FINANCIAL_MEDIA_HOSTS)) return 'financial_media'

  // 4. Blog / newsletter hosts.
  if (host.endsWith('.substack.com') || host === 'substack.com' || /\bblog\b/.test(host) || host.endsWith('.blog')
    || host.endsWith('.wordpress.com') || host.endsWith('.medium.com') || host === 'medium.com') {
    return 'investor_writeup'
  }

  // 5. Generic government / regulatory domains (statistical/regulatory data).
  if (host === 'gov' || host.endsWith('.gov') || host.endsWith('.gov.uk') || host.endsWith('.europa.eu')) {
    return 'regulatory_statistical'
  }

  // 6. Company IR / press / investor-relations.
  if (host.startsWith('investor.') || host.startsWith('ir.')
    || /investor[\s_-]?relations|\/investors?\b|press[\s_-]?release|\/newsroom|\/news\/press/.test(full)) {
    return 'company_disclosure'
  }

  return 'unknown'
}

/** Resolve the per-lane policy (falls back to the conservative default for an unknown lane id). */
export function laneSourcePolicy(lane: string): LaneSourcePolicy {
  return SOURCE_POLICY.lanes[lane] ?? SOURCE_POLICY.default
}

/**
 * True when `category` is admitted for `lane` under the policy. `unknown` is gated by `allow_unknown`
 * (RISKS allows it; classification lanes do not). An excluded category is never admitted; a category
 * neither explicitly allowed nor in `exclude` is treated conservatively (not admitted) unless the
 * lane allows unknown — keeping the whitelist fail-closed.
 */
export function isCategoryAllowedForLane(lane: string, category: SourceCategory): boolean {
  const policy = laneSourcePolicy(lane)
  if (category === 'unknown') return policy.allow_unknown
  if (policy.exclude.includes(category)) return false
  if (policy.allow.includes(category)) return true
  // Not explicitly allowed and not excluded — fail closed unless the lane is allow-everything (risks).
  return policy.allow_unknown && policy.exclude.length === 0
}
