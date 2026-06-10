// model-tiering-spec "Qualification Eval" — the LIVE runner + the persisted report + the production
// gate. This mirrors the EXISTING certification report plumbing (packages/providers/certificationRunner
// + scripts/certify-providers.mjs): an operator-run command (qualify:models) runs the swarm lanes per
// golden-set name, scores them with the PURE scorer (@owlfolio/strategies/qualificationEval), and writes
// a `<provider>.qualification.latest.json` report next to the certification reports. The production gate
// `isModelQualified` reads that latest report — FAIL-CLOSED: no report = not qualified. "Quality is
// verified by the harness, not assumed from the provider."
//
// The runner is OPERATOR/LIVE (it drives real lanes), so it takes an INJECTED `runLane` — the live
// script wires the real swarm; unit tests inject a stub (no provider calls here).

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  GOLDEN_SET,
  type GoldenSet,
} from '@owlfolio/strategies/goldenSet'
import {
  scoreQualification,
  type LaneQualificationOutput,
  type QualificationReport,
} from '@owlfolio/strategies/qualificationEval'

/** One golden-set lane run the live runner produces (same shape the scorer consumes). */
export type QualificationLaneRun = LaneQualificationOutput

/** Identity of the model/provider under qualification (mirrors the certification target's core ids). */
export type ModelQualificationTarget = {
  provider_id: string
  model_id?: string
}

/** The persisted qualification report. Mirrors the CertificationReport shape (id/provider/run_status/
 *  generated_at/summary) so the /providers surface + readers treat it the same way. */
export type ModelQualificationReport = {
  qualification_report_id: string
  provider_id: string
  model_id?: string
  golden_set_version: string
  /** 'completed' when the eval ran; 'not-run' when it could not execute (operator skip / fail-closed). */
  run_status: 'completed' | 'not-run'
  generated_at: string
  /** The aggregate gate verdict (every golden-set name passed + schema-valid rate ≥ 90%). */
  qualified: boolean
  /** The full per-criterion scorer report (for the dossier). */
  result: QualificationReport
  summary: string
  not_run_reason?: string
}

export type RunModelQualificationDeps = {
  /** The frozen golden set (defaults to GOLDEN_SET). */
  goldenSet?: GoldenSet
  /**
   * Run ONE golden-set name's lanes and extract its scoreable output. The live script wires this to
   * the real research swarm (moat/shariah/OE bridge from the deep dive); tests inject a stub. Throwing
   * for a name yields a MISSING output for it (fail-closed → that name is not qualified).
   */
  runLane: (ticker: string) => Promise<QualificationLaneRun>
  generated_at?: string
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/[-_]+$/g, '')
}

/** The provider-keyed file stem for the latest qualification report (mirrors `<provider>.latest.json`). */
export function qualificationReportFileStem(target: Pick<ModelQualificationTarget, 'provider_id'>): string {
  return `${target.provider_id}.qualification`
}

/**
 * OPERATOR/LIVE runner: run each golden-set name's lanes via the injected `runLane`, score the outputs
 * with the pure scorer, and return the persisted report object. Writing it to disk is the script's job
 * (mirrors certify-providers.mjs). A name whose lane run THROWS is omitted from the scored outputs →
 * the scorer marks it MISSING → fail-closed (not qualified). Never throws past its boundary for a single
 * lane failure — the whole report records the gap honestly.
 */
export async function runModelQualification(
  target: ModelQualificationTarget,
  deps: RunModelQualificationDeps,
): Promise<ModelQualificationReport> {
  const goldenSet = deps.goldenSet ?? GOLDEN_SET
  const generatedAt = deps.generated_at ?? new Date().toISOString()
  const outputs: QualificationLaneRun[] = []
  for (const company of goldenSet.companies) {
    try {
      outputs.push(await deps.runLane(company.ticker))
    } catch {
      // Fail-closed: a name that could not be scored is simply absent → scorer marks it missing.
    }
  }
  const result = scoreQualification(outputs, goldenSet)
  const passedCompanies = result.companies.filter((c) => c.qualified).length
  return {
    qualification_report_id: `qual_${safeId(target.provider_id)}_${safeId(target.model_id ?? 'model')}_${safeId(generatedAt)}`,
    provider_id: target.provider_id,
    ...(target.model_id === undefined ? {} : { model_id: target.model_id }),
    golden_set_version: goldenSet.version,
    run_status: 'completed',
    generated_at: generatedAt,
    qualified: result.qualified,
    result,
    summary: `${passedCompanies}/${result.companies.length} golden-set companies passed; schema-valid first-attempt ${(result.schema_valid_first_attempt_rate * 100).toFixed(1)}%. Model is ${result.qualified ? 'QUALIFIED' : 'NOT qualified'} for production research.`,
  }
}

export type IsModelQualifiedResult = {
  qualified: boolean
  /** true when a latest qualification report was found (qualified may still be false). */
  has_report: boolean
  report?: ModelQualificationReport
  reason: string
}

export type IsModelQualifiedOptions = {
  /** The certification/qualification report directory (defaults from env/project root). */
  dir?: string
  env?: Record<string, string | undefined>
  cwd?: string
}

function resolveReportDir(options: IsModelQualifiedOptions): string {
  if (options.dir !== undefined && options.dir.length > 0) return options.dir
  const env = options.env ?? process.env
  if (env['OWLFOLIO_PROVIDER_CERTIFICATION_DIR'] !== undefined && env['OWLFOLIO_PROVIDER_CERTIFICATION_DIR'].length > 0) {
    return env['OWLFOLIO_PROVIDER_CERTIFICATION_DIR']
  }
  const projectRoot = env['OWLFOLIO_PROJECT_DIR'] ?? options.cwd ?? process.cwd()
  return join(projectRoot, 'data', 'provider-certifications')
}

/**
 * Production gate: is this provider's model QUALIFIED (golden-set passed)? Reads the latest persisted
 * qualification report. FAIL-CLOSED: no report, unreadable report, or a not-qualified report all return
 * `qualified: false`. A model/provider used for REAL research should be qualified — surfaced honestly,
 * never assumed.
 */
export async function isModelQualified(
  providerId: string,
  options: IsModelQualifiedOptions = {},
): Promise<IsModelQualifiedResult> {
  const reportDir = resolveReportDir(options)
  const stem = qualificationReportFileStem({ provider_id: providerId })
  let report: ModelQualificationReport | undefined
  try {
    // Prefer the provider-keyed latest file; fall back to scanning for the newest matching report.
    try {
      report = JSON.parse(await readFile(join(reportDir, `${stem}.latest.json`), 'utf8')) as ModelQualificationReport
    } catch {
      const entries = (await readdir(reportDir)).filter((e) => e.startsWith(`qual_${safeId(providerId)}_`) && e.endsWith('.json'))
      let newest: ModelQualificationReport | undefined
      for (const entry of entries) {
        const parsed = JSON.parse(await readFile(join(reportDir, entry), 'utf8')) as ModelQualificationReport
        if (parsed.provider_id !== providerId) continue
        if (newest === undefined || newest.generated_at.localeCompare(parsed.generated_at) < 0) newest = parsed
      }
      report = newest
    }
  } catch {
    report = undefined
  }

  if (report === undefined) {
    return { qualified: false, has_report: false, reason: `No qualification report for ${providerId} — fail-closed (not qualified).` }
  }
  const qualified = report.run_status === 'completed' && report.qualified === true
  return {
    qualified,
    has_report: true,
    report,
    reason: qualified
      ? `Qualified by golden-set report ${report.qualification_report_id} (${report.golden_set_version}).`
      : `Qualification report ${report.qualification_report_id} exists but does NOT qualify (${report.summary}).`,
  }
}
