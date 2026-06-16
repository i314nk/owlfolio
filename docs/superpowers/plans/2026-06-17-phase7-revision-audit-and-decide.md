# Phase 7 Revision — Admission Sign-off Becomes Audit-and-Decide

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invert the admission / re-underwrite sign-off authorship model — the harness marshals the 11 business findings and drafts the thesis; the human audits the presented analysis and makes ONE informed decision (approve / amend / reject) plus a single cognitive-reflection acknowledgement — instead of the human authoring 17 free-text checklist fields and a blank-field signed thesis.

**Architecture:** The 11 business failure-modes become a server-marshaled, read-only audit surface (extending today's "Marshaled evidence" Shariah pattern to all 11). The 6 cognitive items become read-only reflection prompts gated by a single acknowledgement (agent still cannot prefill — there are now no answer fields at all). The signed thesis is pre-filled from the agent draft and the human amends-or-affirms; both draft and final are persisted. The completion-block collapses from "17 filled fields" to "analysis present (server) + human decided (thesis affirmed/amended + cognitive acknowledged)". Decision-neutrality, append-only/human-signed/no-auto-admit, and the audit trail are all preserved.

**Tech Stack:** TypeScript pnpm monorepo; `packages/strategies` (pure checklist engine), `packages/workflow` + `packages/ledger` (events/projections), `apps/web` (Next.js routes + React server-rendered forms), Vitest, Playwright.

**Owner decisions baked in:** §2 → option (a) (6 read-only reflection prompts + single acknowledgement). Findings computed server-side, never client-trusted.

---

## Mental model of the new sign-off (read before any task)

A name's admission sign-off now requires, from the **human**, exactly two acts:
1. **Thesis decision** — the field is pre-filled with the agent's draft thesis; the human affirms it as-is OR amends it (then signs). Non-empty required.
2. **Cognitive acknowledgement** — a single checkbox affirming they reflected on the 6 bias prompts (which are shown read-only).

Everything else (the 11 business findings) is **marshaled by the server from the research projection** and shown read-only. The human never types a business answer.

Persisted at sign-off (audit trail): `signed_thesis_draft` (agent), `signed_thesis` (human final), `thesis_amended` (bool), and `checklist_audit = { version, business_findings: {id→finding}, cognitive_acknowledged }`.

The legacy per-item `checklist_answers: {id→{addressed,note}}` mechanism is removed from the write path. Projections keep tolerating it on **old** events so existing ledgers still project (additive, no migration).

---

## File structure / responsibilities

| File | Responsibility | Change |
|---|---|---|
| `packages/strategies/src/checklistParams.ts` | item definitions (11 business + 6 cognitive) | add `ChecklistAudit` type + `listBusinessItems`/`listCognitiveItems` helpers |
| `packages/strategies/src/checklist.ts` | pure completion engine | **replace** `evaluateChecklistCompletion` semantics (findings-present + cognitive-ack), keep name, stay decision-neutral |
| `apps/web/src/lib/checklistEvidence.ts` | read computed values from projection | add `resolveBusinessFindings` → finding for ALL 11 business items |
| `packages/workflow/src/watchlistWorkflow.ts` | admission event author | payload: add `signed_thesis_draft`/`thesis_amended`/`checklist_audit`, drop required `checklist_answers` |
| `packages/workflow/src/holdingReviewWorkflow.ts` | re-underwrite event author | same payload inversion for confirm + override |
| `packages/ledger/src/projections/watchlistProjection.ts` | watchlist read model | project new audit fields; tolerate legacy `checklist_answers` |
| `packages/ledger/src/projections/holdingProjection.ts` | holding read model | project new audit fields; tolerate legacy |
| `apps/web/src/components/WatchlistPromotionForm.tsx` | admission UI | pre-fill thesis; read-only 11 findings; 6 reflection prompts + 1 ack; drop 17 inputs |
| `apps/web/src/components/HoldingReviewChecklistConfirm.tsx` | re-underwrite affirm UI | same inversion (no thesis field — provider draft) |
| `apps/web/src/components/HoldingReviewOverrideForm.tsx` | re-underwrite amend UI | invert checklist; KEEP human-authored override fields |
| `apps/web/src/app/api/research/[caseId]/watchlist/route.ts` | admission sign-off route | parse thesis + ack; marshal findings server-side; build audit |
| `apps/web/src/app/api/portfolio/[holdingId]/review/[reviewId]/{confirm,override}/route.ts` | re-underwrite routes | same |
| `packages/workflow/src/__tests__/checklistWiringConformance.test.ts` | structural tripwires | update A1/A3; add no-business-text-input + agent-cannot-author-cognitive tripwires; keep A2/A4 |
| e2e + component + route tests | behavior | update to the audit-and-decide flow |

---

## Task 1: Invert the pure completion engine (`packages/strategies`)

**Files:**
- Modify: `packages/strategies/src/checklistParams.ts`
- Modify: `packages/strategies/src/checklist.ts`
- Test: `packages/strategies/src/__tests__/checklist.test.ts`

- [ ] **Step 1: Add types + helpers to `checklistParams.ts`**

Append after the existing exports:

```typescript
/**
 * The harness-authored audit captured at sign-off.
 * - business_findings: one marshaled finding per BUSINESS item id (server-authored, read-only to the human)
 * - cognitive_acknowledged: the human's single acknowledgement that they reflected on the 6 bias prompts
 * No scoring/tally — decision-neutral.
 */
export type ChecklistAudit = {
  version: string
  business_findings: Record<string, string>
  cognitive_acknowledged: boolean
}

export function listBusinessItems(
  params: ChecklistParams = CHECKLIST_PARAMS,
): readonly ChecklistItemDefinition[] {
  return params.items.filter((item) => item.category === 'business')
}

export function listCognitiveItems(
  params: ChecklistParams = CHECKLIST_PARAMS,
): readonly ChecklistItemDefinition[] {
  return params.items.filter((item) => item.category === 'cognitive')
}
```

- [ ] **Step 2: Write failing tests in `checklist.test.ts`**

Replace the body of the file's behavioral tests (keep the imports + the decision-neutral structural grep test, adapting names) with the new semantics. Key cases:

```typescript
import { describe, expect, it } from 'vitest'
import { evaluateChecklistCompletion } from '../checklist'
import {
  CHECKLIST_PARAMS,
  listBusinessItems,
  type ChecklistAudit,
} from '../checklistParams'

function findingsForAllBusiness(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of listBusinessItems()) out[item.id] = `Finding for ${item.id}.`
  return out
}

function completeAudit(): ChecklistAudit {
  return {
    version: CHECKLIST_PARAMS.version,
    business_findings: findingsForAllBusiness(),
    cognitive_acknowledged: true,
  }
}

describe('evaluateChecklistCompletion (audit-and-decide)', () => {
  it('is complete when every business item has a finding and cognitive is acknowledged', () => {
    const result = evaluateChecklistCompletion(completeAudit())
    expect(result.complete).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('is incomplete and names the business item when a finding is missing', () => {
    const audit = completeAudit()
    const firstBiz = listBusinessItems()[0]!.id
    delete audit.business_findings[firstBiz]
    const result = evaluateChecklistCompletion(audit)
    expect(result.complete).toBe(false)
    expect(result.missing).toContain(firstBiz)
  })

  it('treats a whitespace-only finding as missing', () => {
    const audit = completeAudit()
    const firstBiz = listBusinessItems()[0]!.id
    audit.business_findings[firstBiz] = '   '
    expect(evaluateChecklistCompletion(audit).missing).toContain(firstBiz)
  })

  it('is incomplete when cognitive reflection is not acknowledged', () => {
    const audit = completeAudit()
    audit.cognitive_acknowledged = false
    const result = evaluateChecklistCompletion(audit)
    expect(result.complete).toBe(false)
    expect(result.missing).toContain('cognitive_acknowledgement')
  })

  it('does NOT require findings for cognitive items', () => {
    // a complete audit has findings only for business items; cognitive items are never in business_findings
    const audit = completeAudit()
    for (const id of Object.keys(audit.business_findings)) {
      expect(CHECKLIST_PARAMS.items.find((i) => i.id === id)?.category).toBe('business')
    }
    expect(evaluateChecklistCompletion(audit).complete).toBe(true)
  })

  it('is decision-neutral: result has exactly { complete, missing }, no numeric/score field', () => {
    const result = evaluateChecklistCompletion(completeAudit()) as Record<string, unknown>
    expect(Object.keys(result).sort()).toEqual(['complete', 'missing'])
    for (const v of Object.values(result)) expect(typeof v).not.toBe('number')
  })

  it('extensibility: a newly-added business item is automatically required to have a finding', () => {
    const extended = {
      version: 'test-extended',
      items: [
        ...CHECKLIST_PARAMS.items,
        { id: 'new_business_risk', category: 'business' as const, prompt: 'New?' },
      ],
    }
    const audit = completeAudit() // lacks new_business_risk
    const result = evaluateChecklistCompletion(audit, extended)
    expect(result.complete).toBe(false)
    expect(result.missing).toContain('new_business_risk')
  })
})
```

Also KEEP a grep-style test asserting the source has no scoring/tally arithmetic (port the existing one at the old lines 225-254 — it greps `checklist.ts` for `score`/`tally`/`weight`/`pass_count`/`n_of_m`; leave it intact).

- [ ] **Step 3: Run tests to verify they fail**

Run: `corepack pnpm --filter @owlfolio/strategies test` (or repo-root `corepack pnpm test` — strategies tests run from root)
Expected: FAIL — `evaluateChecklistCompletion` still has the old `(answers)` signature / returns `unaddressed`.

- [ ] **Step 4: Reimplement `evaluateChecklistCompletion` in `checklist.ts`**

Replace the function and its return type:

```typescript
import {
  CHECKLIST_PARAMS,
  listBusinessItems,
  type ChecklistAudit,
  type ChecklistParams,
} from './checklistParams'

export type ChecklistCompletion = {
  complete: boolean
  missing: string[]
}

const COGNITIVE_ACK_SENTINEL = 'cognitive_acknowledgement'

function hasFinding(findings: Record<string, string>, id: string): boolean {
  const value = findings[id]
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Decision-neutral completion of the audit-and-decide checklist.
 * Complete IFF every business item has a non-empty marshaled finding AND the human acknowledged
 * the cognitive reflection. No scoring/tally — `missing` simply lists what blocks the decision.
 */
export function evaluateChecklistCompletion(
  audit: ChecklistAudit,
  params: ChecklistParams = CHECKLIST_PARAMS,
): ChecklistCompletion {
  const missing: string[] = []
  for (const item of listBusinessItems(params)) {
    if (!hasFinding(audit.business_findings, item.id)) missing.push(item.id)
  }
  if (audit.cognitive_acknowledged !== true) missing.push(COGNITIVE_ACK_SENTINEL)
  return { complete: missing.length === 0, missing }
}
```

Remove the now-dead `ChecklistAnswer` `isAddressed` helper IF nothing else imports `ChecklistAnswer`; if other packages still import the type, keep the type export but delete the old evaluation logic. (Grep `ChecklistAnswer` across the repo before deleting — Task 3 removes the remaining write-path users.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `corepack pnpm test` (filter to checklist if faster)
Expected: PASS, all Task-1 cases green.

- [ ] **Step 6: Commit**

```bash
git add packages/strategies/src/checklistParams.ts packages/strategies/src/checklist.ts packages/strategies/src/__tests__/checklist.test.ts
git commit -m "feat(strategies): invert checklist engine to findings-present + cognitive-ack (decision-neutral)"
```

---

## Task 2: Server-side business-findings marshaling for all 11 items

**Files:**
- Modify: `apps/web/src/lib/checklistEvidence.ts`
- Test: `apps/web/src/lib/__tests__/checklistEvidence.test.ts` (create if absent)

The existing `resolveChecklistEvidence` returns formatted values only for groundable items (those with `reads`). The new `resolveBusinessFindings` must return a finding for **all 11** business items so the audit surface is never an empty field.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { resolveBusinessFindings } from '../checklistEvidence'
import { listBusinessItems } from '@owlfolio/strategies/checklistParams'

describe('resolveBusinessFindings', () => {
  it('returns a non-empty finding for every business item, even with an empty projection', () => {
    const findings = resolveBusinessFindings(undefined)
    for (const item of listBusinessItems()) {
      expect(findings[item.id]?.trim().length ?? 0).toBeGreaterThan(0)
    }
  })

  it('surfaces a grounded value when the projection has it', () => {
    const projection = {
      valuation: { terminal_value_pct_of_iv: 0.42 },
    } as never
    const findings = resolveBusinessFindings(projection)
    expect(findings.terminal_value_optimism).toContain('0.42')
  })

  it('marks a non-groundable item as qualitative rather than leaving it blank', () => {
    const findings = resolveBusinessFindings(undefined)
    // capital_allocation has no `reads`
    expect(findings.capital_allocation.toLowerCase()).toContain('qualitative')
  })

  it('never emits a finding keyed to a cognitive item', () => {
    const findings = resolveBusinessFindings(undefined)
    expect(findings.anchoring).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL** (`resolveBusinessFindings` not exported).

Run: `corepack pnpm test` (or filter web)

- [ ] **Step 3: Implement `resolveBusinessFindings`**

Reuse the existing dotted-path resolver + `formatEvidence` already in the file. Add:

```typescript
import { listBusinessItems } from '@owlfolio/strategies/checklistParams'

const QUALITATIVE_FINDING =
  'Qualitative — no automated metric; audit against the signed thesis and research brief.'
const GROUNDED_ABSENT_FINDING = 'No grounded value available in this case.'

/**
 * One marshaled finding per BUSINESS item (read-only audit surface).
 * - groundable (`reads` set) + value present → formatted value
 * - groundable + value absent → honest "no grounded value" (never fabricated)
 * - non-groundable (no `reads`) → qualitative pointer to the thesis/research
 * Cognitive items are intentionally excluded (the agent must not author them).
 */
export function resolveBusinessFindings(
  projection: ResearchCaseProjection | undefined,
): Record<string, string> {
  const findings: Record<string, string> = {}
  for (const item of listBusinessItems()) {
    if (item.reads === undefined) {
      findings[item.id] = QUALITATIVE_FINDING
      continue
    }
    const value = resolvePath(projection, item.reads) // existing helper in this file
    const formatted = value === undefined ? undefined : formatEvidence(value)
    findings[item.id] =
      formatted !== undefined && formatted.length > 0 ? formatted : GROUNDED_ABSENT_FINDING
  }
  return findings
}
```

(If `resolvePath`/`formatEvidence` are not currently exported within the module scope, reference them directly — they live in this same file per the exploration map. Do not duplicate them.)

- [ ] **Step 4: Run test — expect PASS.**

Run: `corepack pnpm test`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/checklistEvidence.ts apps/web/src/lib/__tests__/checklistEvidence.test.ts
git commit -m "feat(web): marshal a business finding for all 11 items (read-only audit surface)"
```

---

## Task 3: Event contracts + projections — persist the audit, keep legacy tolerant

**Files:**
- Modify: `packages/workflow/src/watchlistWorkflow.ts`
- Modify: `packages/workflow/src/holdingReviewWorkflow.ts`
- Modify: `packages/ledger/src/projections/watchlistProjection.ts`
- Modify: `packages/ledger/src/projections/holdingProjection.ts`
- Modify: `packages/ledger/src/domainEventContracts.ts` (contract types for the three events)
- Test: existing workflow + projection tests (`packages/workflow/src/__tests__/*`, `packages/ledger/src/**/__tests__/*`)

- [ ] **Step 1: Update payload types (contracts)**

In `watchlistWorkflow.ts` `WatchlistDraftCreatedPayload`: keep `thesis_summary` (agent draft) and `signed_thesis` (human final); ADD:

```typescript
  signed_thesis_draft: string      // agent-drafted thesis the human reviewed
  thesis_amended: boolean          // true iff signed_thesis !== signed_thesis_draft
  checklist_audit: ChecklistAudit  // harness findings + human cognitive acknowledgement
  // REMOVE the required `checklist_answers` field from the create input/payload
```

Mirror in `domainEventContracts.ts`. Import `ChecklistAudit` from `@owlfolio/strategies/checklistParams`.

In `holdingReviewWorkflow.ts` `HoldingReviewConfirmedPayload` and `HoldingReviewOverriddenPayload`: replace `checklist_answers` with `checklist_audit: ChecklistAudit`. Override keeps its authored fields (`rationale`, `evidence_summary`, `uncertainty`, `thesis_health`, `action_stance`, `next_review_at`).

- [ ] **Step 2: Update the workflow append/guard functions**

`confirmWatchlistDraft` (and the atomic `watchlist_draft_confirmed`), `confirmHoldingReviewDraft`, `overrideHoldingReviewDraft` now accept a `checklist_audit` (+ thesis fields for admission) and must call `evaluateChecklistCompletion(audit)` and throw on `!complete` — preserving the A1 wiring property with the new signature. Example for admission:

```typescript
import { evaluateChecklistCompletion } from '@owlfolio/strategies/checklist'

export function confirmWatchlistDraft(input: ConfirmWatchlistDraftInput): DomainEvent[] {
  const completion = evaluateChecklistCompletion(input.checklist_audit)
  if (!completion.complete) {
    throw new Error(
      `Checklist audit incomplete; missing: ${completion.missing.join(', ')}`,
    )
  }
  if (input.signed_thesis.trim().length === 0) {
    throw new Error('Signed thesis is required (affirm or amend the draft).')
  }
  // ... build watchlist_draft_created + watchlist_draft_confirmed with:
  //   signed_thesis_draft: input.signed_thesis_draft,
  //   signed_thesis: input.signed_thesis,
  //   thesis_amended: input.signed_thesis.trim() !== input.signed_thesis_draft.trim(),
  //   checklist_audit: input.checklist_audit,
}
```

- [ ] **Step 3: Update projections — project new, tolerate legacy**

`watchlistProjection.ts`: project `signed_thesis`, `signed_thesis_draft?`, `thesis_amended?`, `checklist_audit?`. KEEP projecting legacy `checklist_answers?` when an old event carries it (do not delete the fold branch — old ledgers must still project). Same shape for `holdingProjection.ts` (`checklist_audit?` + legacy `checklist_answers?`).

```typescript
// in the fold for watchlist_draft_created:
if (payload.checklist_audit !== undefined) next.checklist_audit = payload.checklist_audit
if (payload.signed_thesis_draft !== undefined) next.signed_thesis_draft = payload.signed_thesis_draft
if (payload.thesis_amended !== undefined) next.thesis_amended = payload.thesis_amended
// legacy tolerance (old events only):
if (payload.checklist_answers !== undefined) next.checklist_answers = payload.checklist_answers
```

- [ ] **Step 4: Update + run the workflow/projection tests**

Update fixtures in `watchlistWorkflow`/`holdingReviewWorkflow` tests and projection tests to pass `checklist_audit` + thesis draft/final instead of `checklist_answers`. Add a projection test asserting an OLD event carrying `checklist_answers` still projects (legacy tolerance) AND a new event carrying `checklist_audit` projects the audit + `thesis_amended`.

Run: `corepack pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow/src/watchlistWorkflow.ts packages/workflow/src/holdingReviewWorkflow.ts packages/ledger/src/projections/watchlistProjection.ts packages/ledger/src/projections/holdingProjection.ts packages/ledger/src/domainEventContracts.ts packages/workflow/src/__tests__ packages/ledger/src
git commit -m "feat(ledger): persist checklist_audit + thesis draft/final; tolerate legacy checklist_answers"
```

---

## Task 4: Admission UI + route — pre-filled thesis, read-only findings, single cognitive ack

**Files:**
- Modify: `apps/web/src/components/WatchlistPromotionForm.tsx`
- Modify: `apps/web/src/app/api/research/[caseId]/watchlist/route.ts`
- Modify: `apps/web/src/lib/workflow.ts` (wire `thesisDraft` + `businessFindings` into the form's render path, ~lines 714-812)
- Test: `apps/web/src/components/__tests__/WatchlistPromotionForm.test.tsx`, `apps/web/src/app/api/research/[caseId]/watchlist/route.test.ts`

- [ ] **Step 1: Update component test (`WatchlistPromotionForm.test.tsx`)**

New expectations:
- thesis textarea is **pre-filled** with the passed `thesisDraft` (not empty)
- all 11 business items render their finding (read-only `data-testid="checklist-finding-<id>"`), and there are **no** `checklist_note[`/`checklist_addressed[` inputs
- the 6 cognitive items render as read-only reflection prompts + exactly ONE acknowledgement checkbox `name="cognitive_reflection_acknowledged"`
- submit disabled until thesis non-empty AND cognitive ack checked
- no count/progress badge

```typescript
it('pre-fills the thesis from the agent draft and renders findings read-only', () => {
  render(
    <WatchlistPromotionForm
      researchCaseId="rc_x"
      thesisDraft="Agent: durable moat, fair price."
      businessFindings={{ overpaying_for_quality: 'market_implied_growth = 0.05', /* …all 11… */ }}
    />,
  )
  expect(screen.getByLabelText(/signed thesis/i)).toHaveValue('Agent: durable moat, fair price.')
  expect(screen.queryByRole('textbox', { name: /checklist_note/i })).toBeNull()
  expect(screen.getByTestId('checklist-finding-overpaying_for_quality')).toHaveTextContent('0.05')
  // exactly one acknowledgement
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
})
```

- [ ] **Step 2: Run — expect FAIL.** `corepack pnpm test`

- [ ] **Step 3: Reimplement `WatchlistPromotionForm.tsx`**

- Props: add `thesisDraft: string` and `businessFindings: Record<string, string>`; drop `evidence` (superseded — but if other call sites pass `evidence`, keep it as an alias and prefer `businessFindings`).
- State: `const [signedThesis, setSignedThesis] = useState(thesisDraft)` (PRE-FILLED), `const [cognitiveAck, setCognitiveAck] = useState(false)`. Remove the per-item `answers` state entirely.
- Render: for each `listBusinessItems()` item → prompt + `Marshaled finding: ${businessFindings[item.id]}` in a read-only `<p data-testid={...}>`. For `listCognitiveItems()` → prompt text read-only (NO input). One acknowledgement checkbox: "I have reflected on these reasoning checks for my own thinking." + hidden `<input type="hidden" name="signed_thesis_draft" value={thesisDraft} />`.
- `canPromote = signedThesis.trim().length > 0 && cognitiveAck`.
- Submit posts: `signed_thesis`, `signed_thesis_draft`, `cognitive_reflection_acknowledged`. (Business findings are NOT posted — server recomputes.)
- Keep zero count/progress badge.

- [ ] **Step 4: Update the admission route (`watchlist/route.ts`)**

```typescript
import { resolveBusinessFindings } from '@/lib/checklistEvidence'
import { CHECKLIST_PARAMS } from '@owlfolio/strategies/checklistParams'

const signedThesis = (form.get('signed_thesis') ?? '').toString()
const signedThesisDraft = (form.get('signed_thesis_draft') ?? '').toString()
const cognitiveAck = form.get('cognitive_reflection_acknowledged') === 'on'

const projection = /* existing research-case projection lookup */
const checklist_audit = {
  version: CHECKLIST_PARAMS.version,
  business_findings: resolveBusinessFindings(projection),
  cognitive_acknowledged: cognitiveAck,
}
// confirmWatchlistDraft throws on incomplete audit / empty thesis → map to 400
```

Return 400 when `confirmWatchlistDraft` throws (incomplete audit or empty thesis), matching the existing error→400 mapping.

- [ ] **Step 5: Update route test (`watchlist/route.test.ts`)**

Replace `appendCompleteChecklist` (17 fields) with a helper that sets only `signed_thesis` + `signed_thesis_draft` + `cognitive_reflection_acknowledged=on`. Add tests:
- happy path: thesis + ack → 200/redirect, event persisted with `checklist_audit` (11 findings) + `thesis_amended` correct
- missing ack → 400
- empty thesis → 400
- **gate §6.2:** zero business free-text posted still succeeds (the helper sends none)

- [ ] **Step 6: Run — expect PASS.** `corepack pnpm test`

- [ ] **Step 7: typecheck + lint + build**

Run: `corepack pnpm typecheck && corepack pnpm lint && NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build`
Expected: green (known Turbopack NFT warning OK).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/WatchlistPromotionForm.tsx apps/web/src/components/__tests__/WatchlistPromotionForm.test.tsx apps/web/src/app/api/research/[caseId]/watchlist/route.ts apps/web/src/app/api/research/[caseId]/watchlist/route.test.ts apps/web/src/lib/workflow.ts
git commit -m "feat(web): admission sign-off becomes audit-and-decide (pre-filled thesis, read-only findings, single cognitive ack)"
```

---

## Task 5: Re-underwrite parity — confirm (affirm) + override (amend)

**Files:**
- Modify: `apps/web/src/components/HoldingReviewChecklistConfirm.tsx`
- Modify: `apps/web/src/components/HoldingReviewOverrideForm.tsx`
- Modify: `apps/web/src/app/api/portfolio/[holdingId]/review/[reviewId]/confirm/route.ts`
- Modify: `apps/web/src/app/api/portfolio/[holdingId]/review/[reviewId]/override/route.ts`
- Test: the matching component + route tests

Map: **confirm = affirm the provider draft as-is** (no thesis field — uses provider draft); **override = amend** (human authors override fields). Both invert the checklist to read-only findings + single cognitive ack.

- [ ] **Step 1: Update confirm component test + component**

`HoldingReviewChecklistConfirm.tsx`: add prop `businessFindings: Record<string, string>`; render 11 read-only findings + 6 read-only cognitive prompts + ONE `cognitive_reflection_acknowledged` checkbox; remove per-item inputs; `canConfirm = cognitiveAck`. Submit posts `cognitive_reflection_acknowledged` only.

- [ ] **Step 2: Update override component test + component**

`HoldingReviewOverrideForm.tsx`: KEEP the human-authored override fields (`thesis_health`, `action_stance`, `rationale`, `evidence_summary`, `uncertainty`, `next_review_at`) — that IS the amendment. Invert ONLY the checklist (read-only findings + 6 prompts + single ack). `canOverride = thesisFieldsComplete && cognitiveAck`. Remove the 17 checklist inputs.

- [ ] **Step 3: Update both routes**

Both compute `business_findings` server-side from the holding's research/review projection (use `resolveBusinessFindings` against the relevant projection) and build `checklist_audit = { version, business_findings, cognitive_acknowledged }`; pass to `confirmHoldingReviewDraft` / `overrideHoldingReviewDraft`, which throw on incomplete → 400.

- [ ] **Step 4: Update route tests** (`confirm/route.test.ts`, `override/route.test.ts`)

Replace `appendCompleteChecklist` with the ack-only helper (+ override fields for override). Assert events persist `checklist_audit`; assert missing ack → 400.

- [ ] **Step 5: Run + typecheck + lint + build.**

Run: `corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/HoldingReviewChecklistConfirm.tsx apps/web/src/components/HoldingReviewOverrideForm.tsx 'apps/web/src/app/api/portfolio/[holdingId]/review/[reviewId]/confirm' 'apps/web/src/app/api/portfolio/[holdingId]/review/[reviewId]/override' apps/web/src/components/__tests__/HoldingReviewChecklistConfirm.test.tsx apps/web/src/components/__tests__/HoldingReviewOverrideForm.test.tsx
git commit -m "feat(web): re-underwrite confirm/override become audit-and-decide (read-only findings + cognitive ack)"
```

---

## Task 6: Update + extend the structural tripwires

**Files:**
- Modify: `packages/workflow/src/__tests__/checklistWiringConformance.test.ts`

Update the source-level greps to the new mechanism and ADD two tripwires for the inversion's integrity properties.

- [ ] **Step 1: Update A1 (engine wired + blocks)**

Assert `confirmWatchlistDraft`, `confirmHoldingReviewDraft`, `overrideHoldingReviewDraft` each call `evaluateChecklistCompletion(` AND throw on `!...complete`. (Same property, new signature.)

- [ ] **Step 2: Keep A2 (decision-neutral)** — engine + hosts + evidence + routes + forms carry no `score`/`tally`/`weight`/`pass_count`/`n_of_m`; forms render no count/progress badge.

- [ ] **Step 3: Update A3 (cognitive human-only + agent-cannot-author)**

- cognitive items in `CHECKLIST_PARAMS` still carry NO `reads` (unchanged)
- NEW: `resolveBusinessFindings` source must NOT reference any cognitive item id (grep the cognitive ids against `checklistEvidence.ts` → zero hits) — the agent has no path to author cognitive content
- the three forms render the cognitive prompts but expose NO cognitive answer input (only the single `cognitive_reflection_acknowledged`)

- [ ] **Step 4: ADD tripwire — no human business free-text (the 17-field mechanism is gone)**

Grep the three form components + three routes: assert ZERO occurrences of `checklist_note[` and `checklist_addressed[`. This is the executable proof that the human no longer authors business answers (acceptance gate §6.2/§6.5).

- [ ] **Step 5: Keep A4 (extensibility)** — adding a business item to params auto-requires a finding (already covered by the engine test; assert here that the evidence layer iterates `listBusinessItems`, no hardcoded per-item list).

- [ ] **Step 6: Run — expect PASS.** `corepack pnpm test`

- [ ] **Step 7: Commit**

```bash
git add packages/workflow/src/__tests__/checklistWiringConformance.test.ts
git commit -m "test(workflow): tripwires for audit-and-decide (no business free-text, agent-cannot-author-cognitive, engine still blocks)"
```

---

## Task 7: e2e migration to the audit-and-decide flow

**Files:**
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts` (admission ~118-150; re-underwrite confirm ~224-242; override ~254-279)
- Modify: `apps/web/e2e/accounting-monthly.spec.ts` (admission ~31-50)

- [ ] **Step 1: Rewrite the admission preamble**

Replace the 17-field fill with:
```typescript
// Thesis is pre-filled from the agent draft; affirm-as-is (amend optional)
const signedThesis = page.getByLabel(/signed thesis/i)
await expect(signedThesis).not.toHaveValue('') // pre-filled by the harness
// single cognitive acknowledgement
await page.getByLabel(/reflected on these reasoning checks/i).check()
const promoteButton = page.getByRole('button', { name: /promote to watchlist/i })
await expect(promoteButton).toBeEnabled()
await promoteButton.click()
```
Remove all `checklist_note[`/`checklist_addressed[` loops.

- [ ] **Step 2: Rewrite re-underwrite confirm + override**

Confirm: check the single ack inside `form[action$="/confirm"]`, then "apply provider draft". Override: fill the override fields (unchanged) + check the single ack inside `form[action$="/override"]`, then "apply user override". Remove the checklist note/addressed loops in both.

- [ ] **Step 3: Run e2e**

> **PRECONDITION:** the dev server must NOT be occupying port 3000 (the owner's manual test server). If it is, DEFER this step and report — do not kill the owner's server. The Playwright config starts its own server on 3000.

Run: `corepack pnpm e2e`
Expected: all specs green (grep the actual pass/fail counts; do not trust the runner's exit code alone). The `retries: 2` for the known override-tail flake stays.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/personal-workflow-intake.spec.ts apps/web/e2e/accounting-monthly.spec.ts
git commit -m "test(e2e): drive audit-and-decide admission + re-underwrite (affirm thesis + single cognitive ack)"
```

---

## Final verification (whole tree)

```bash
git diff --check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm audit --filter @owlfolio/web --prod --audit-level moderate
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
corepack pnpm e2e   # only when port 3000 is free
```

## Acceptance-gate → task map (self-review)

| Spec gate | Task |
|---|---|
| §6.1 harness authors 11 business findings | Task 2 + Task 4 (render) |
| §6.2 human authors zero business text | Task 4 (route helper) + Task 6 (no-business-text tripwire) |
| §6.3 cognitive surfaced, not typed, agent-cannot-prefill | Task 4/5 (single ack) + Task 6 (A3) |
| §6.4 thesis harness-drafted + human-amendable, both recorded | Task 3 (payload) + Task 4 (pre-fill) |
| §6.5 completion-block = reviewed + decided | Task 1 (engine) + Task 4/5 |
| §6.6 decision-neutral preserved | Task 1 + Task 6 (A2) |
| §6.7 audit trail persisted + projected | Task 3 |
| §6.8 re-underwrite parity | Task 5 |
| §6.9 e2e drives new flow | Task 7 |
