/**
 * The model stamps a draft placeholder thesis before sources are read ("Will formulate after
 * reading source material"); no board or card may present it as the recorded thesis. Shared by
 * the research library and the watchlist so the guard never drifts between surfaces.
 */
const PLACEHOLDER_THESIS = /^\s*(will formulate|to be (?:formulated|determined|written))\b/i

/** The thesis if one was genuinely recorded; undefined for blank or placeholder summaries. */
export function recordedThesis(summary: string | undefined): string | undefined {
  if (summary === undefined || summary.trim() === '' || PLACEHOLDER_THESIS.test(summary)) return undefined
  return summary
}
