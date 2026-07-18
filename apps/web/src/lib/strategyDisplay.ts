/**
 * Strategy DISPLAY names (rebrand, owner-locked 2026-07-16): the persisted `strategy_id` stays
 * `buffett-munger` in the ledger and config forever; everywhere a user reads it, the strategy is
 * "Buffett 4-Pillar". Unknown ids fall back to the raw id — never an invented name.
 */
const STRATEGY_DISPLAY_NAMES: Record<string, string> = {
  'buffett-munger': 'Buffett 4-Pillar',
}

export function strategyDisplayName(strategyId: string): string {
  return STRATEGY_DISPLAY_NAMES[strategyId] ?? strategyId
}
