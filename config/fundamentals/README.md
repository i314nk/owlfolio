# Local-manual fundamentals store

This directory holds **operator-entered** primary annual fundamentals for names that are **not on SEC
EDGAR** and have no free, reliable structured API — notably GCC issuers on the DFM / ADX (e.g. **DEWA,
TABREED, EMPOWER, TALABAT**). Owlfolio is fail-closed and local-first, so rather than adding a keyed
third-party API of uncertain coverage, these names get their primary data the honest way: an operator
transcribes the figures from the issuer's **audited annual report** into a typed JSON file with
provenance, and the system uses them deterministically.

These files are **checked into git** (unlike the gitignored `data/` tree). They are read by
`LocalManualFundamentalsProvider` and take precedence over EDGAR in `resolveFundamentalsForTicker`
(operator override wins).

## Adding a name

1. Copy `_TEMPLATE.json` to `{TICKER}.json` (UPPERCASE ticker, e.g. `DEWA.json`).
2. Replace every value with figures **transcribed from the audited annual report**. Do **not** fabricate,
   estimate, or scrape — if a figure is not disclosed, leave that field out (the owner-earnings bridge
   fails closed on missing inputs).
3. Fill in `source` provenance: the annual-report URL, the `filed` (publication) date used as the as-of
   date, and a `note` describing exactly which statements the figures came from.

The resolver **skips** any file whose ticker starts with `_`, so `_TEMPLATE.json` is never treated as a
real name.

## Field conventions

- **Currency**: set `currency` to the ISO code the financial statements are presented in (e.g. `AED`,
  `SAR`, `QAR`). Every `*_musd` field is in **millions of that currency** (a value of `1000` means one
  billion of the reporting currency). Share counts (`*_m`) are in **millions of shares**.
- **`diluted_shares_m`**: the weighted-average **diluted** share count for the fiscal year.
- **`annual_series`**: newest-first or any order (it is sorted newest-first on load). Provide as many
  years as the OE bridge / incremental-ROIC window needs (≥ 5 is useful).

## Currency caveat (important)

The backtest values owner-earnings-per-share (in this `currency`) against a market price. The price
**must be quoted in the same currency** — the issuer's local listing, never a USD ADR. Mixing a
non-USD fundamental with a USD ADR price produces a meaningless verdict. See the EDGAR/IFRS path
(`secEdgar.ts`) and the backtest's `price_currency` handling for the same constraint applied to Novo
Nordisk (DKK fundamentals ↔ `NOVO-B.CO` DKK price).
