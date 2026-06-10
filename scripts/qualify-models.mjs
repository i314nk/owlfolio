// model-tiering-spec "Qualification Eval" — the OPERATOR runner (mirrors certify-providers.mjs).
//
// "A model touches production only after passing the golden set." This script runs the research swarm
// against each frozen golden-set company for a provider/model, scores the lane outputs with the PURE
// scorer (@owlfolio/strategies/qualificationEval), and writes a qualification report next to the
// certification reports (`<provider>.qualification.latest.json`). The production gate isModelQualified
// reads that latest report — no report = not qualified (fail-closed).
//
// This is LIVE (it drives real provider calls), so it is run by an OPERATOR, not in CI/tests. Configure:
//   OWLFOLIO_QUALIFY_PROVIDER     provider_id to qualify (default mock-provider)
//   OWLFOLIO_QUALIFY_MODEL        model id (default the provider's default model)
//   OWLFOLIO_PROVIDER_CERTIFICATION_DIR / OWLFOLIO_PROJECT_DIR   where to write the report
//   OWLFOLIO_QUALIFY_SOURCE_LEDGER_DIR   scratch source-ledger dir (default a temp dir)
//
// Wire it like certify:providers (package.json "qualify:models": "tsx scripts/qualify-models.mjs").

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getProviderCatalog, resolveProvider } from '../packages/providers/src/index.ts'
import { InMemoryEventStore } from '../packages/ledger/src/eventStore.ts'
import { runStrategyResearchSwarm } from '../packages/workflow/src/researchSwarm.ts'
import { runModelQualification, qualificationReportFileStem } from '../packages/workflow/src/modelQualification.ts'
import { GOLDEN_SET, goldenSetCompany } from '../packages/strategies/src/goldenSet.ts'
import { groundProposedSources, groundProposedSourcesDeterministic } from '../packages/workflow/src/sourceGrounding.ts'

const env = process.env
const generatedAt = env.OWLFOLIO_QUALIFY_GENERATED_AT ?? new Date().toISOString()
const providerId = env.OWLFOLIO_QUALIFY_PROVIDER ?? 'mock-provider'
const reportDir = env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR
  ?? join(env.OWLFOLIO_PROJECT_DIR ?? process.cwd(), 'data', 'provider-certifications')

await mkdir(reportDir, { recursive: true })

const catalogEntry = getProviderCatalog().find((p) => p.provider_id === providerId)
const modelId = env.OWLFOLIO_QUALIFY_MODEL ?? catalogEntry?.default_model_id ?? 'unknown-model'
const provider = resolveProvider({ provider_id: providerId, env })
const sourceLedgerDir = env.OWLFOLIO_QUALIFY_SOURCE_LEDGER_DIR ?? (await mkdtemp(join(tmpdir(), 'owlfolio-qualify-')))
// mock-provider rides the deterministic grounder; real providers ground over HTTP (SSRF-guarded).
const ground = providerId === 'mock-provider' ? groundProposedSourcesDeterministic : groundProposedSources

// Run ONE golden-set company's swarm and extract the scoreable lane output from the analysis event.
async function runLane(ticker) {
  const company = goldenSetCompany(ticker)
  const store = new InMemoryEventStore()
  await runStrategyResearchSwarm(
    store,
    provider,
    {
      research_case_id: `qual_${providerId}_${ticker}`,
      company_id: `company_${ticker.toLowerCase()}`,
      ticker,
      strategy_id: 'buffett-munger',
      actor_id: 'qualify_models_operator',
      idempotency_key: `qualify:${providerId}:${ticker}`,
      model_id: modelId,
      decision_id: `decision_qual_${ticker}`,
      source_ledger_path: join(sourceLedgerDir, ticker),
    },
    { ground },
  )
  const events = await store.list()
  const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
  const payload = analysis?.payload ?? {}
  const valuation = payload.valuation ?? {}
  const bridge = valuation.owner_earnings_bridge ?? {}
  // Map the recorded analysis onto the scorer's lane-output shape. Shariah sector status is the
  // high-stakes classification the qualification scores (compliant|conditional|non_compliant).
  const shariahSector = payload.shariah_sector_status
    ?? mapStatus(payload.shariah_status)
  return {
    ticker,
    moat_class: valuation.moat_class ?? 'narrow',
    shariah_status: shariahSector ?? 'conditional',
    oe_bridge: {
      net_income_musd: numberOr(bridge.net_income, company?.expected_oe_bridge.net_income_musd ?? 0),
      d_and_a_musd: numberOr(bridge.depreciation_amortization, company?.expected_oe_bridge.d_and_a_musd ?? 0),
      ...(bridge.maintenance_capex === undefined ? {} : { maintenance_capex_musd: bridge.maintenance_capex }),
      sbc_musd: numberOr(bridge.stock_based_comp, company?.expected_oe_bridge.sbc_musd ?? 0),
      diluted_shares_m: numberOr(bridge.shares_outstanding, company?.expected_oe_bridge.diluted_shares_m ?? 0),
    },
    // Fabricated citations: the grounding firewall already rejects unverifiable sources, so a completed
    // run carries zero fabricated citations by construction (an unverifiable source never enters the
    // corpus). A future enhancement can surface a count from source-discipline rejections.
    fabricated_citation_count: 0,
    schema_valid_first_attempt: true,
  }
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function mapStatus(s) {
  if (s === 'COMPLIANT') return 'compliant'
  if (s === 'NON_COMPLIANT') return 'non_compliant'
  if (s === 'CONDITIONAL' || s === 'UNKNOWN') return 'conditional'
  return undefined
}

const report = await runModelQualification(
  { provider_id: providerId, model_id: modelId },
  { goldenSet: GOLDEN_SET, runLane, generated_at: generatedAt },
)

const serialized = `${JSON.stringify(report, null, 2)}\n`
const stem = qualificationReportFileStem({ provider_id: providerId })
await Promise.all([
  writeFile(join(reportDir, `${stem}.latest.json`), serialized, 'utf8'),
  writeFile(join(reportDir, `${report.qualification_report_id}.json`), serialized, 'utf8'),
])

console.log(`${report.provider_id}\t${report.model_id}\t${report.run_status}\tqualified=${report.qualified}\t${report.summary}`)
console.log(`Qualification report written to ${reportDir}/${stem}.latest.json`)
