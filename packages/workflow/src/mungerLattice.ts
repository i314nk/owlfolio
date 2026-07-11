// ---------------------------------------------------------------------------------------------------
// S7 (Phase 3 pillars): the Munger mental-model LATTICE at synthesis — a DETERMINISTIC harness
// assembly over artifacts that already exist in the pipeline. The honesty rule: no model ever emits
// "I applied inversion" — the harness asserts a mental model was applied ONLY when its underlying
// artifact exists and survived its cite-check. Anything absent or ungrounded renders 'unavailable'
// WITH the reason. The four v1 models and their artifacts:
//   inversion          ← the inversion pass (E1: the case argued against itself; replaces the red team)
//   base rates         ← the base-rate burden flags (exceptional claims vs structural evidence)
//   incentive analysis ← the S5 management comp_structure (grounded DEF 14A citation)
//   social proof       ← the inversion pass's consensus_check (is the thesis just the consensus?)
// ---------------------------------------------------------------------------------------------------

/** The inversion pass's consensus check after the harness cite-check (rides the inversion call). */
export type ConsensusCheck = {
  consensus_view: string
  thesis_vs_consensus: 'consensus' | 'variant'
  variant_justification?: string | undefined
  /** Only the citations that verified against the corpus. */
  citations: string[]
  /** True when >=1 citation verified — an ungrounded consensus read carries no lattice weight. */
  grounded: boolean
}

export type MungerLatticeEntry = {
  model: 'inversion' | 'base_rates' | 'incentive_analysis' | 'social_proof'
  status: 'applied' | 'unavailable'
  /** What the model concluded (applied) — derived from the artifact, never free-standing prose. */
  summary: string
  /** Where the substance lives on the dossier (the artifact this entry is derived from). */
  evidence_ref: string
  /** Why the model could not be applied (unavailable). */
  reason?: string
}

export type MungerLattice = {
  entries: MungerLatticeEntry[]
  note: string
}

export type BuildMungerLatticeArgs = {
  /** E1: the inversion pass replaces the red team — no answer-or-downgrade obligation machinery. */
  inversion:
    | {
        status: 'complete'
        strongest_objection: { claim: string; severity: 'low' | 'medium' | 'high'; citations: string[] }
        consensus_check?: ConsensusCheck | undefined
      }
    | { status: 'inversion_incomplete'; reason: string }
  /** The base-rate burden result (flags with status met/unmet). Absent → unavailable. */
  baseRateBurden?: { flags: Array<{ claim: string; status: string }> } | undefined
  /** The resolved S5 management judgment (the comp_structure is the incentive artifact). */
  managementJudgment?: {
    integrity?: {
      comp_structure: { summary: string; alignment: 'aligned' | 'mixed' | 'misaligned'; citation: string }
      comp_grounded: boolean
    } | undefined
  } | undefined
}

/** Assemble the lattice deterministically. Pure; no I/O; no model calls. */
export function buildMungerLattice(args: BuildMungerLatticeArgs): MungerLattice {
  const entries: MungerLatticeEntry[] = []

  // ---- Inversion: the case argued against itself. Applied when a CITE-CHECKED objection exists
  //      (it was injected into the synthesis prompt, so the verdict weighed it); unavailable when the
  //      pass failed or the objection lost all its citations (a fabricated counter-argument is no
  //      counter-argument). ----
  if (args.inversion.status === 'complete') {
    const objection = args.inversion.strongest_objection
    if (objection.citations.length > 0) {
      entries.push({
        model: 'inversion',
        status: 'applied',
        summary: `The case was argued against itself: strongest objection (${objection.severity}) — "${objection.claim}"; the synthesis weighed it before the verdict.`,
        evidence_ref: 'inversion',
      })
    } else {
      entries.push({
        model: 'inversion',
        status: 'unavailable',
        summary: 'The case was not argued against itself.',
        evidence_ref: 'inversion',
        reason: 'the strongest objection lost all its citations to the cite-check (a fabricated counter-argument carries no weight)',
      })
    }
  } else {
    entries.push({
      model: 'inversion',
      status: 'unavailable',
      summary: 'The case was not argued against itself.',
      evidence_ref: 'inversion',
      reason: `inversion_incomplete: ${args.inversion.reason}`,
    })
  }

  // ---- Base rates: exceptional claims must beat the outside view with structural evidence. ----
  if (args.baseRateBurden !== undefined) {
    const unmet = args.baseRateBurden.flags.filter((f) => f.status === 'unmet').length
    const total = args.baseRateBurden.flags.length
    entries.push({
      model: 'base_rates',
      status: 'applied',
      summary: total === 0
        ? 'No claims beat a base rate — the thesis stays inside the outside view.'
        : `${total} base-rate-beating claim(s) checked against structural evidence; ${unmet} unmet (unmet burdens are surfaced, never silently passed).`,
      evidence_ref: 'base_rate_burden',
    })
  } else {
    entries.push({
      model: 'base_rates',
      status: 'unavailable',
      summary: 'The base-rate burden was not evaluated.',
      evidence_ref: 'base_rate_burden',
      reason: 'base-rate burden not computed for this run',
    })
  }

  // ---- Incentive analysis: how the people are paid (the grounded DEF 14A comp structure). ----
  const comp = args.managementJudgment?.integrity
  if (comp !== undefined && comp.comp_grounded) {
    entries.push({
      model: 'incentive_analysis',
      status: 'applied',
      summary: `Executive incentives read from the DEF 14A (${comp.comp_structure.alignment}): ${comp.comp_structure.summary}`,
      evidence_ref: 'management_judgment',
    })
  } else {
    entries.push({
      model: 'incentive_analysis',
      status: 'unavailable',
      summary: 'Executive incentives were not established from a grounded proxy.',
      evidence_ref: 'management_judgment',
      reason: comp === undefined
        ? 'the management lane emitted no integrity block'
        : 'the comp-structure citation did not ground against the corpus',
    })
  }

  // ---- Social proof: is the thesis just the consensus wearing analysis clothes? ----
  const consensus = args.inversion.status === 'complete' ? args.inversion.consensus_check : undefined
  if (consensus !== undefined && consensus.grounded) {
    entries.push({
      model: 'social_proof',
      status: 'applied',
      summary: consensus.thesis_vs_consensus === 'consensus'
        ? `CAUTION — the thesis IS the consensus: ${consensus.consensus_view} A consensus thesis carries no variant edge; the price likely already reflects it.`
        : `Variant view vs the consensus ("${consensus.consensus_view}"): ${consensus.variant_justification ?? 'justification not stated'}`,
      evidence_ref: 'inversion.consensus_check',
    })
  } else {
    entries.push({
      model: 'social_proof',
      status: 'unavailable',
      summary: 'The thesis-vs-consensus check could not be applied.',
      evidence_ref: 'inversion.consensus_check',
      reason: args.inversion.status !== 'complete'
        ? `inversion_incomplete: ${args.inversion.reason}`
        : consensus === undefined
          ? 'the inversion pass emitted no consensus check'
          : 'consensus check ungrounded (no citation verified — carries no weight)',
    })
  }

  return {
    entries,
    note: 'Deterministic harness assembly: a mental model is marked applied ONLY when its underlying artifact exists and survived its cite-check — no model self-reports applying a lattice model.',
  }
}
