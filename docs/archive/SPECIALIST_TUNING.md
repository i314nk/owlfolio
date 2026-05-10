# Specialist Prompt Tuning

> **STATUS: APPLIED & ARCHIVED — 2026-04-26**
>
> All 7 tunings in this document were applied during the 2026-04-26
> two-zone strategy restructure. The new home for each tuned prompt is
> `strategies/<strategy>.yaml` under `prompts.specialists.<name>` (the
> tunings were merged into the new self-contained prose blocks rather
> than left as separate `role`/`sources` fields).
>
> Map of tunings → final location:
>
> | # | Strategy            | Specialist               | Final location                                    |
> |---|---------------------|--------------------------|---------------------------------------------------|
> | 1 | growth              | competitive_dynamics     | `strategies/growth.yaml` prompts.specialists      |
> | 2 | quality-compounder  | competitive_durability   | `strategies/quality-compounder.yaml` ↑            |
> | 3 | growth              | tam_analyst              | `strategies/growth.yaml` ↑                        |
> | 4 | quality-compounder  | margin_analyst           | `strategies/quality-compounder.yaml` ↑            |
> | 5 | garp                | competitive_position     | `strategies/garp.yaml` ↑                          |
> | 6 | buffett-munger      | management_analyst       | `strategies/buffett-munger.yaml` ↑                |
> | 7 | 100-bagger          | owner_operator_analyst   | `strategies/100-bagger.yaml` ↑                    |
>
> This file is kept as a historical reference for the audit reasoning.
> The line numbers and `role: >` instructions below point at the
> pre-restructure YAML shape and no longer apply.

*Created: 2026-04-25*
*Applied: 2026-04-26 (two-zone restructure)*
*Source: External audit of all 35 specialist role prompts across 7 strategies*

## Context

Each strategy YAML defines 3-5 specialists with a `role` field that becomes the specialist's prompt (injected via `runner.py` line 137 into the `YOUR ROLE:` section). The role text is the primary driver of output quality — it determines what the specialist searches for, what metrics it reports, and how structured the output is.

After reviewing all 35 specialist prompts, 28 are production-ready with concrete metrics, thresholds, and explicit flag triggers. **7 need tuning** — they're either too vague, use subjective language without benchmarks, or make speculative predictions without grounding in observable data.

## How To Apply

For each tuning below, replace the `role: >` block in the specified strategy YAML file. The `sources:` section stays unchanged unless noted.

---

## Tuning 1: Growth — `competitive_dynamics`

**File:** `strategies/growth.yaml` (line 298)
**Problem:** No metrics, no scoring, no concrete outputs. Says "map the competitive landscape" but doesn't define what good looks like. Most likely to produce hand-wavy narrative.

**Current:**
```yaml
  competitive_dynamics:
    role: >
      Map the competitive landscape: market share trends, competitor moves,
      product leadership position, and barriers to entry. Assess whether
      the company is gaining or losing share. Identify well-funded incumbents
      or startups threatening the growth thesis. Evaluate product differentiation
      and switching costs that protect growth durability.
```

**Proposed:**
```yaml
  competitive_dynamics:
    role: >
      Quantify competitive position and trajectory. For each area, provide
      specific data points — not narrative:

      1. MARKET SHARE: Find the company's market share (%) and direction
         over the past 3 years. Is it gaining or losing? Quantify the gain/loss
         in percentage points. Identify the top 2-3 competitors and their
         share trends.

      2. PRODUCT LEADERSHIP: Assess product differentiation. Look for NPS
         scores, G2/Gartner rankings, or app store ratings if available.
         Is the product a leader, challenger, or follower in its category?

      3. BARRIERS TO ENTRY: Score 1-5:
         - 5: Regulatory moat or deep data advantage (years to replicate)
         - 4: Strong network effects or high switching costs
         - 3: Brand + scale advantages but replicable with capital
         - 2: Differentiation exists but thin (features, not moat)
         - 1: Low barriers — competitors can enter with funding alone

      4. COMPETITIVE THREATS: Identify the single biggest threat to growth
         sustainability. Is there a well-funded competitor (>$500M raised or
         >$1B market cap) directly attacking this company's core product?

      Flag RED if market share declining 2+ years. Flag RED if a competitor
      with >$1B in resources has launched a directly competing product in
      the last 12 months. Flag GREEN if market share expanding AND barriers
      score >= 4.
```

---

## Tuning 2: 100-Bagger — `owner_operator_analyst`

**File:** `strategies/100-bagger.yaml` (line 342)
**Problem:** "Smart acquisitions at disciplined prices" is subjective. No benchmarks for what constitutes good capital allocation vs empire-building.

**Current:**
```yaml
  owner_operator_analyst:
    role: >
      Assess founder/owner-operator status: is the founder still
      leading? What is insider ownership as % of shares outstanding?
      Review capital allocation track record over 10+ years — smart
      acquisitions at disciplined prices, or empire-building waste?
      Check proxy statement for compensation alignment with long-term
      value creation. Flag if CEO has <2% ownership or short tenure.
```

**Proposed:**
```yaml
  owner_operator_analyst:
    role: >
      Assess founder/owner-operator alignment with long-term compounding.
      Use concrete benchmarks — not narrative judgment:

      1. FOUNDER STATUS: Is the founder still CEO or in a key leadership
         role? If not, when did they leave and why? Founder-led scores higher.

      2. INSIDER OWNERSHIP: Find insider ownership as % of shares outstanding.
         Benchmarks by market cap:
         - <$5B: expect >5% insider ownership (founder skin in the game)
         - $5-50B: expect >2%
         - >$50B: expect >0.5% (even 0.5% of $100B = $500M personal stake)
         Flag if insider ownership is below these thresholds.

      3. CAPITAL ALLOCATION TRACK RECORD (10+ years):
         - Acquisitions: calculate average acquisition multiple paid (EV/Revenue
           or EV/EBITDA). Compare to industry median. Score as disciplined
           if acquisitions were at <3x revenue or <15x EBITDA on average.
         - ROIC on acquisitions: did acquisitions maintain or improve overall
           ROIC within 2-3 years? If ROIC declined >3% post-acquisition and
           never recovered, flag as empire-building.
         - Buybacks: were shares repurchased below intrinsic value (P/E < 15
           or P/FCF < 20 at time of buyback) or at inflated prices?
         - Dividends vs reinvestment: for a 100-bagger candidate, reinvestment
           at high ROIC is preferred over dividends. Flag if >50% of FCF goes
           to dividends with ROIC >20% (should be reinvesting).

      4. COMPENSATION: Check proxy DEF 14A. Is CEO comp >3% of net income?
         Is compensation tied to long-term metrics (5yr ROIC, TSR) or
         short-term (1yr EPS, revenue targets)?

      Score owner-operator alignment 1-5:
      - 5: Founder-led, >5% ownership, disciplined capital allocation, long-term comp
      - 4: Professional CEO but >2% ownership, strong track record
      - 3: Professional CEO, <2% ownership but no red flags
      - 2: Low ownership, questionable acquisitions or excessive comp
      - 1: Empire-builder — declining ROIC on acquisitions, excessive comp, insider selling
```

---

## Tuning 3: Quality Compounder — `competitive_durability`

**File:** `strategies/quality-compounder.yaml` (line 345)
**Problem:** Asks "will the advantage exist in 20 years?" — that's speculation, not analysis. Needs grounding in observable present-day signals.

**Current:**
```yaml
  competitive_durability:
    role: >
      Will the competitive advantage exist in 20 years? Assess
      disruption risk from technology shifts, new entrants, or
      regulatory changes. Evaluate whether the moat is widening
      or narrowing over time. Consider: is the advantage rooted
      in data, regulation, switching costs, or brand — and how
      durable is each source? Flag if the industry is facing
      structural disruption that could erode quality metrics.
```

**Proposed:**
```yaml
  competitive_durability:
    role: >
      Assess competitive durability using OBSERVABLE present-day signals.
      Do not predict the future — measure what is happening NOW that
      indicates whether the advantage is strengthening or weakening.

      1. MOAT SOURCE CLASSIFICATION: Identify the primary moat source:
         - Data/IP: proprietary data that grows with usage (strongest)
         - Regulation: licenses, certifications, legal barriers
         - Switching costs: deeply embedded in customer workflows
         - Network effects: value increases with each additional user
         - Brand/trust: reputation that takes decades to build
         - Scale: cost advantages from size
         Rate durability of each active source: HIGH / MEDIUM / LOW.

      2. OBSERVABLE DISRUPTION SIGNALS (check all):
         - Are new entrants gaining >2% market share per year?
         - Has a well-funded competitor ($1B+) entered in the last 3 years?
         - Is the core technology facing obsolescence risk (e.g., on-prem
           to cloud, physical to digital)?
         - Are regulators actively reviewing the company's market position?
         - Is customer concentration increasing (top 10 customers growing
           as % of revenue)?

      3. MOAT TRAJECTORY (measurable):
         - Gross margin trend over 5 years (expanding = moat strengthening)
         - Market share trend over 3 years
         - Pricing power evidence: has the company raised prices >CPI in
           the last 3 years without volume loss?
         - Customer retention/NRR if available

      4. DURABILITY SCORE (1-5):
         - 5: Multiple moat sources (data + switching + regulation), no
           disruption signals visible, gross margins expanding
         - 4: Strong primary moat, minor disruption signals, margins stable
         - 3: Single moat source, some competitive pressure, margins flat
         - 2: Moat narrowing — share loss, margin compression, or new
           entrant gaining traction
         - 1: Structural disruption underway — technology shift or
           regulatory change actively eroding the advantage

      Flag RED if any disruption signal is YES. Flag GREEN if durability
      score >= 4 AND gross margins expanding.
```

---

## Tuning 4: Growth — `tam_analyst`

**File:** `strategies/growth.yaml` (line 275)
**Problem:** TAM estimates from web sources are notoriously inflated. Needs methodology for grounding TAM in reality.

**Current:**
```yaml
  tam_analyst:
    role: >
      Size the total addressable market (TAM), assess current penetration rate,
      and identify expansion vectors (new geographies, adjacent products,
      platform extensions). Estimate remaining runway for revenue growth.
      Cross-reference multiple industry reports and company disclosures.
      Flag if TAM is shrinking or penetration is above 50%.
```

**Proposed:**
```yaml
  tam_analyst:
    role: >
      Size the addressable market using grounded methodology — not
      inflated analyst projections. TAM estimates are the most commonly
      exaggerated metric in growth investing. Be skeptical.

      1. BOTTOM-UP TAM (preferred): Calculate TAM = (# of potential
         customers) x (average revenue per customer). Use the company's
         own disclosures for customer count and ARPU when available.
         This is more reliable than top-down industry reports.

      2. TOP-DOWN TAM (secondary): If bottom-up isn't possible, find
         2-3 independent estimates from different research firms.
         Report the RANGE, not a single number. If estimates diverge
         by >2x, flag the uncertainty explicitly.

      3. COMPANY vs ANALYST TAM: Compare the company's own TAM estimate
         (from investor presentations) to third-party estimates. If the
         company claims >2x what analysts estimate, flag as potentially
         promotional.

      4. PENETRATION RATE: Current revenue / TAM estimate = penetration.
         This is the most important metric:
         - <5%: Very early, high runway but high uncertainty
         - 5-20%: Sweet spot for growth investing (proven product, long runway)
         - 20-50%: Growth is decelerating, watch for S-curve flattening
         - >50%: Limited upside, growth strategy may not apply

      5. EXPANSION VECTORS: List specific vectors (new geography, adjacent
         product, platform) with estimated incremental TAM for each.
         Distinguish between proven vectors (already generating revenue)
         and aspirational ones (announced but not launched).

      Flag RED if penetration >50%. Flag RED if company's TAM claim is
      >2x independent estimates. Flag GREEN if penetration 5-20% with
      proven expansion vectors.
```

---

## Tuning 5: GARP — `competitive_position`

**File:** `strategies/garp.yaml` (line 291)
**Problem:** "Can it raise prices without losing customers?" has no framework for measurement. Needs concrete pricing power indicators.

**Current:**
```yaml
  competitive_position:
    role: >
      Assess market position and pricing power: is the company gaining
      or losing market share? Can it raise prices without losing customers?
      Identify competitive threats that could erode earnings growth.
      Evaluate whether the competitive position supports sustained
      earnings growth at current rates for the next 3-5 years.
```

**Proposed:**
```yaml
  competitive_position:
    role: >
      Assess competitive position with measurable indicators of pricing
      power and market strength. GARP requires sustained EARNINGS growth —
      competitive position must support that specifically.

      1. PRICING POWER (concrete evidence):
         - Gross margin trajectory over 5 years: expanding = pricing power,
           compressing = cost pressure or competition
         - Revenue per unit/customer trend: growing above inflation = real
           pricing power
         - ASP (average selling price) growth vs volume growth: if ASP
           growing, the company is raising prices successfully

      2. MARKET SHARE: Quantify if possible (% and direction over 3 years).
         If exact share isn't available, use revenue growth vs industry
         growth as a proxy (outgrowing industry = gaining share).

      3. COMPETITIVE THREATS TO EARNINGS:
         - Identify the top 2 competitors. Are they gaining or losing share?
         - Is pricing pressure visible (competitors cutting prices, discounting)?
         - Is the industry consolidating or fragmenting?

      4. EARNINGS SUSTAINABILITY: Can current earnings growth rate (the CAGR
         used for PEG) be maintained for 3-5 years?
         - Is growth organic or acquisition-driven?
         - Are margins expanding (operating leverage) or flat?
         - Are there one-time tailwinds inflating current growth (COVID pull-
           forward, stimulus, pricing catch-up)?

      Score competitive position 1-5:
      - 5: Market leader, gross margins expanding, pricing above CPI, no credible threat
      - 4: Strong position, stable margins, gaining share
      - 3: Competitive but pricing pressure exists, margins flat
      - 2: Losing share or margin compression visible
      - 1: Commodity competitor — no pricing power, shrinking share

      Flag RED if gross margins declined 3+ consecutive years. Flag GREEN
      if market leader with expanding margins.
```

---

## Tuning 6: Buffett-Munger — `management_analyst`

**File:** `strategies/buffett-munger.yaml` (line 428)
**Problem:** Lists what to check but sets no quality bars. "Smart or wasteful" buybacks/acquisitions is subjective without thresholds.

**Current:**
```yaml
  management_analyst:
    role: >
      Assess management quality: insider ownership percentage, recent insider
      buying/selling, CEO tenure and track record, capital allocation history
      (buybacks, acquisitions, dividends — smart or wasteful?), executive
      compensation vs performance, board independence.
```

**Proposed:**
```yaml
  management_analyst:
    role: >
      Assess management quality using Buffett's framework: treat management
      as capital allocators, not operators. The key question is whether they
      deploy each dollar of retained earnings to generate >$1 of market value.

      1. INSIDER OWNERSHIP: Find ownership % for CEO, CFO, and top 5 insiders.
         Benchmarks:
         - >3% of market cap = strong alignment (excellent)
         - 1-3% = adequate
         - <1% = weak alignment (flag)
         Check trailing 12-month insider transactions: net buying = bullish
         signal, net selling = investigate why (planned 10b5-1 = neutral,
         discretionary selling = concerning)

      2. CEO TENURE & TRACK RECORD:
         - Tenure >7 years: proven operator with visible track record
         - Tenure 3-7 years: evaluate trajectory
         - Tenure <3 years: too early, flag as uncertain
         - Check total shareholder return (TSR) vs S&P 500 during tenure

      3. CAPITAL ALLOCATION (most important for Buffett):
         - Buybacks: were shares repurchased below intrinsic value?
           Check average buyback price vs current earnings yield. Buying
           at P/E >25 while ROIC <15% = wasteful. Buying at P/E <18
           with ROIC >15% = smart.
         - Acquisitions: average ROIC on acquired businesses vs organic
           ROIC. If acquisitions drag overall ROIC down, flag as empire-
           building.
         - Retained earnings test: for every $1 retained over the past
           5 years, has market cap increased by >$1? If not, should be
           paying dividends instead.

      4. COMPENSATION: CEO total comp as % of net income.
         - <1% = reasonable
         - 1-3% = acceptable for smaller companies
         - >3% = excessive, flag
         Check if comp is tied to ROIC/FCF (aligned) or revenue/EPS
         targets (can be gamed).

      Score management quality 1-5:
      - 5: High ownership, net buying, >7yr tenure, $1 retained = >$1 value created
      - 4: Adequate ownership, neutral transactions, good capital allocation
      - 3: Low ownership but no red flags, average track record
      - 2: Questionable capital allocation — value-destroying M&A or badly timed buybacks
      - 1: Empire-builder — excessive comp, declining ROIC, insider selling
```

---

## Tuning 7: Quality Compounder — `margin_analyst`

**File:** `strategies/quality-compounder.yaml` (line 333)
**Problem:** Says "excessive SBC erodes real margins" but never defines what "excessive" means. No benchmarks for margin expansion expectations.

**Current:**
```yaml
  margin_analyst:
    role: >
      Analyze margin trajectory over 5-10 years: are gross margins
      expanding or contracting? Is operating leverage improving
      (operating margin expanding faster than gross margin)?
      Calculate SBC as % of revenue — excessive SBC erodes real
      margins. Assess pricing power: can the company raise prices
      without losing volume? Flag margin compression trends.
```

**Proposed:**
```yaml
  margin_analyst:
    role: >
      Analyze margin trajectory with concrete benchmarks. Quality
      compounders should show stable or expanding margins over a full
      business cycle (7-10 years). Temporary dips during recessions
      are acceptable — structural decline is not.

      1. GROSS MARGIN: Report 5-year and 10-year trend. For a quality
         compounder:
         - Software/platforms: expect 60-85%, flag if <60%
         - Asset-light services (ratings, data, payments): expect 50-75%
         - Consumer brands: expect 40-65%
         - Flag if gross margin contracted >200bps over any 3-year period
           outside of a recession

      2. OPERATING LEVERAGE: Is operating margin expanding faster than
         gross margin? Calculate the gap:
         - Expanding gap = positive operating leverage (scale benefits)
         - Flat gap = no leverage (costs growing with revenue)
         - Shrinking gap = negative leverage (spending outpacing growth)
         Quality compounders should show >50bps/year operating margin
         expansion on average over 5 years.

      3. SBC AS % OF REVENUE (concrete thresholds):
         - <5%: Excellent — minimal dilution
         - 5-10%: Acceptable for tech/growth phase
         - 10-15%: Concerning — real margins are significantly overstated
         - 15-25%: Red flag — report GAAP operating margin alongside
           adjusted margin. The gap IS the problem.
         - >25%: Disqualifying for quality compounder status

      4. PRICING POWER EVIDENCE:
         - Has the company raised prices above CPI (>3-4%) in the last
           3 years?
         - Revenue per customer/unit trend: growing, flat, or declining?
         - Did pricing increases lead to volume loss (churn, downgrades)?
         Pricing power is confirmed if prices rose above CPI with stable
         or growing volume.

      5. FCF MARGIN: Calculate FCF as % of revenue. Quality compounders
         should convert >15% of revenue to FCF. Flag if FCF margin <10%
         or declining.

      Score margin quality 1-5:
      - 5: Gross >60%, operating expanding >50bps/yr, SBC <5%, FCF >20%
      - 4: Gross >50%, margins stable or expanding, SBC <10%, FCF >15%
      - 3: Gross >40%, margins flat, SBC 10-15%, FCF >10%
      - 2: Margins compressing or SBC 15-25%
      - 1: Structural margin decline or SBC >25%

      Flag RED if SBC >15% of revenue. Flag RED if gross margin declined
      >200bps over 3 years (non-recession). Flag GREEN if operating
      margin expanding AND SBC <10%.
```

---

## Summary

| # | Strategy | Specialist | Problem | Severity |
|---|----------|-----------|---------|----------|
| 1 | Growth | `competitive_dynamics` | No metrics, no scoring, narrative-only | High |
| 2 | 100-Bagger | `owner_operator_analyst` | Subjective ("smart", "disciplined") | Medium |
| 3 | Quality Compounder | `competitive_durability` | 20-year prediction, ungrounded | High |
| 4 | Growth | `tam_analyst` | TAM estimates ungrounded | Medium |
| 5 | GARP | `competitive_position` | No pricing power framework | Medium |
| 6 | Buffett-Munger | `management_analyst` | No quality bars or benchmarks | Medium |
| 7 | Quality Compounder | `margin_analyst` | Missing SBC/margin benchmarks | Medium |

## Notes for Claude Code

- Each tuning is a direct replacement of the `role: >` block in the specified YAML file
- The `sources:` sections are unchanged — only the role text is being replaced
- After applying, run `pytest tests/` to make sure YAML loading still works
- The tuned prompts are longer but stay within the runner's context budget (each specialist gets its own Agent SDK call with full context)
- Extended thinking is already enabled for specialists, so the longer prompts will benefit from deeper reasoning
