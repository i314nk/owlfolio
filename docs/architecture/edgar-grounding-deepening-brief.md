# Brief: Deepen EDGAR grounding (read primary text; decide interim recency)

**Audience:** the agent working the EDGAR tree (`packages/workflow/src/secEdgar.ts`,
`researchSwarmCompute.ts`).
**Status:** design brief. Companion to the provider-tree brief (grounded agentic web offload).
**Relationship:** this tree owns *what the harness grounds and computes*. The provider tree owns
*transport + tool loop*. The seam between them is the `fetch_source` / source-id contract — **owned
here, consumed there** (see Coordination).

## Goal

The harness today resolves ticker→CIK→companyfacts XBRL + submissions→latest 10-K, extracts ~15
structured financial fields × up to 11 years, grounds the 10-K as a hashed citable source, and
injects distilled numbers + that source-id into the lanes. Two gaps follow from that scope:

1. The model gets the **numbers** inline but, for the moat / qualitative lanes, only a bare
   **source-id** — it can cite the 10-K but not *read* it unless a provider tool-loop fetches it.
2. The grounded floor is **annual and as-of-the-last-10-K**. Nothing covers post-10-K recency
   (10-Q quarters, 8-K material events, subsequent-events disclosures).

This tree closes (1) cleanly and **decides** whether to close (2).

## The non-negotiable invariant (unchanged)

> **Code computes; judgment proposes.** The harness pulls raw EDGAR numbers and recomputes owner
> earnings, ROIC, and the AAOIFI Shariah ratios itself. The model supplies judgment only. Every
> citable filing is content-hashed + ledgered before the model may cite it. Fail-closed: any EDGAR
> error returns `undefined` and the lanes run as if EDGAR weren't there.

Nothing in this tree weakens that. Slice A adds a *read* path to an *already-grounded* document.
Slice B, if taken, grounds *more* documents the same way — it does not move computation into the
model.

---

## Slice A — let the model read the grounded 10-K, BY ITEM (do first)

> **Correction to the original framing.** This was first written as "no new fetch, just plumbing."
> That was wrong: `fetchAndCaptureSource` hashes the body and **discards it** — only a 600-char
> excerpt + the hash survive (`CapturedSource` has no content field; the ledger persists only
> `excerpt` + `content_hash`; there is no content store). So reading the 10-K needs either retained
> content or a re-fetch, and full-text was never viable anyway. The corrected design follows.

**What:** a section-aware read contract — `read_source(source_id, {section})` — that returns a
**hash-verified** slice (e.g. Item 1A Risk Factors) of an already-grounded filing the harness handed
the model in `buildPreVerifiedSourcesBlock` (`researchSwarmCompute.ts:613`).

**Content availability — two paths, BOTH correct:**
- **A2 (fast path):** retain the body we already fetched in-memory on the run's `CapturedSource`
  (`content?`), so an in-run read needs no second fetch.
- **A1 (verification path):** when content isn't in memory (cross-session read), re-fetch the URL,
  re-hash, and assert it equals the ledgered `content_hash`. EDGAR Archives URLs are **immutable** (a
  filing at its accession URL is content-stable), so this is a genuine integrity check, not a
  best-effort guess — it passes or fail-closes. Cross-session reads ALWAYS take this path.

  > A2 is the fast path; A1 is the verification path. The in-run double-fetch A2 avoids is a
  > performance optimization over a path that is *also* correct.

**Hard guard (anti-laundering):** the hash-match assertion fails closed to **uncitable/unreadable**
on mismatch — NEVER fall back to the 600-char excerpt or to the A2 memory copy. A mismatch on a
supposedly-immutable URL means something is wrong (wrong URL, truncated fetch, ledger corruption); the
safe answer is "this source is no longer readable," never "read it anyway from the copy I kept." This
is what stops the read path from laundering content that doesn't match its hash. The cite-check still
validates against the **hash**, not the text the model echoes back.

**The real unit of work — the 10-K Item parser.** Addressing a filing by **Item** is the deliverable:
Item 1 (Business) and Item 1A (Risk Factors) for moat/risks; Item 7 (MD&A) for the qualitative
trajectory read — exactly the lanes that were starving. The read contract is trivial once you can
answer "give me Item 1A of this source-id." Offset paging is a fallback for filings that don't parse
into Items cleanly; **Item-scoping is the high-value path.**

**Why it's high-value:** the moat lane is the most under-fed lane — it deliberately does NOT receive
`buildPrimaryFilingBlock` (`researchSwarmCompute.ts:632`), so its reasoning rests on a bare source-id
plus the model's own knowledge. Letting it read the primary Item 1/1A/7 text is the single biggest
qualitative-grounding upgrade available, entirely inside the existing invariant.

**Scope of work (this tree's side):**
- The **10-K Item parser** (pure, no network): given filing text, return a requested Item's section
  (TOC-vs-body disambiguated; fail-closed when not parseable). This is the bulk of the work.
- **Content retention + verified read**: `content?` on `CapturedSource` (A2) + a re-fetch-and-verify
  read (A1) that fail-closes to uncitable on hash mismatch.
- The **read contract** `read_source(source_id, {section})`: resolve id → content (A2/A1) → parse
  section → return, carrying the **lane tag** so `sourcePolicy.ts` still governs what a read source
  can support. Keep the "do NOT invent SEC archive URLs" guard intact.

**Non-goals for A:** no new filings, no new computed fields, no change to `annual_series`/recomputed
ratios, and **no change to how content is captured or hashed** — A adds retention + a verified read
on top. A is reading, not computing.

**Dependency:** A's read path is only *exercised* by a tool-loop-capable provider, but is built and
unit-tested here independently (parser + verified read), then certified once the provider tree lands
its loop. Build now; don't block on the provider tree.

---

## Slice B — close the interim-recency gap (decide before building)

**The gap:** the grounded floor stops at the latest **annual** 10-K. For value investing, a material
subsequent event absolutely can break a thesis — a post-10-K quarter, an 8-K (guidance change,
impairment, executive departure, M&A), a subsequent-events note. None of that is grounded today. The
provider-tree web offload is currently the *only* path to it — and that path is best-effort,
risks-lane-only, non-reproducible by design.

**The decision this forces (open, owner):**

> Is post-10-K recency **load-bearing** for the verdict, or **risk color**?

- If **risk color** → leave it to the web tier. The provider brief ships as written. This tree does
  nothing for B. Write one sentence in the provider brief: "interim recency is intentionally
  best-effort; EDGAR grounds annual only."
- If **load-bearing** → it must become a **grounded tier**, not an offload. Best-effort web must not
  silently carry decision-critical recency. That means this tree grounds 10-Q / 8-K the same way it
  grounds the 10-K.

**If B is taken, the work is methodology, not fetch:**
- **10-Q:** quarterly XBRL facts are messier than annual (tag variance, restatements, YTD-vs-quarter
  framing). Decide how an interim quarter interacts with `annual_series` and the recomputed
  owner-earnings / ROIC / Shariah ratios — annotate-only (surface latest quarter, don't recompute),
  or fold into a trailing-twelve-months basis. **Annotate-only is the safer v1.**
- **8-K:** heterogeneous, mostly unstructured. Likely grounds as a **readable hashed document**
  (like the 10-K under Slice A) rather than a parsed-numbers source — feeding the *qualitative* lanes
  (risks, moat, thesis-break triggers), not the numeric ones.
- **Recency check:** captured interim sources carry `filed_date` / period-end; flag/reject anything
  staler than the latest grounded filing (mirrors the provider-tree freshness constraint, but on the
  *grounded* tier).
- **Fail-closed everywhere:** an interim fetch/parse error returns `undefined`; the lane runs on the
  annual floor as today.

**Recommendation:** B is "yes in principle, scoped separately." Don't let the provider web offload
paper over it. Make the load-bearing-vs-color call explicitly; if load-bearing, do **8-K-as-readable-
document** first (cheap, high signal, reuses A's read contract) and **10-Q-annotate-only** second.
Full interim numeric integration is a later, deliberate step.

---

## Sequencing

1. **A first.** Highest value-to-effort, inside the invariant, unblocks moat. Build the source-id
   read contract + lane tag now; certify when the provider loop lands.
2. **B decision now, B build later.** Make the load-bearing call before the provider brief ships so
   its recency framing is honest. If load-bearing: 8-K-as-document → 10-Q-annotate-only → (later)
   interim numerics.

## Coordination (seam with the provider tree)

- **The source-id read contract is owned here, consumed there.** The grounding + lane-tagging is the
  part that must not drift, so it lives in this tree; the provider tree's `fetch_source` transport
  calls into it. Define it before either side hard-codes the boundary, or you get a merge seam on the
  most safety-sensitive line in the system.
- **The interim-recency decision is made here and communicated to the provider tree.** Its answer
  determines whether the provider brief's web offload is "risk color" (ship) or "covering an
  ungrounded gap" (provider brief must disclaim that the gap is *this tree's* to close, not web's).
- **Don't touch `groundedAgent.ts` grounding semantics** from this tree without coordinating — A
  reads ledgered content, it does not change how content is captured or hashed.

## One-line summary

> The 10-K is already grounded — let the model **read** it (Slice A, moat's biggest upgrade, inside
> the invariant). The floor is annual — **decide** whether post-10-K recency is load-bearing; if so,
> ground 10-Q/8-K (Slice B), don't offload it to best-effort web.
