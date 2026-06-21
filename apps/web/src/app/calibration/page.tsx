import { redirect } from 'next/navigation'

/**
 * /calibration is RETIRED. The owner-curated calibration backtest desk (universe controls, run button,
 * deployment-ratio metric, and valuation-parameter version history) was removed as dead, closed-loop code.
 * The live forecast/Brier "calibration & integrity" surfacing lives on /performance instead. This route now
 * permanently redirects home so old links, bookmarks, and in-app references keep working.
 */
export default function CalibrationPage(): never {
  redirect('/')
}
