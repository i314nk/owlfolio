import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectHoldings } from './holdingProjection'
import { projectResearchCases } from './researchCaseProjection'
import { projectWatchlist } from './watchlistProjection'

export type CommandCenterRecentActivity = {
  event_id: string
  label: string
}

export type CommandCenterHoldingReviewPrompt = {
  holding_id: string
  label: string
  next_review_at: string
  status: 'due' | 'upcoming'
  days_until_review: number
}

export type CommandCenterSummary = {
  pipeline_counts: {
    research_cases: number
    watchlist_drafts: number
    confirmed_watchlist_items: number
    open_holdings: number
    pending_user_actions: number
  }
  primary_research_case_id?: string
  next_recommended_action: string
  holding_review_prompts: CommandCenterHoldingReviewPrompt[]
  recent_activity: CommandCenterRecentActivity[]
}

export type CommandCenterProjectionOptions = {
  as_of?: string
}

function actorLabel(event: LedgerEventEnvelope<unknown>): string {
  return event.actor_id === undefined ? event.actor_type : `${event.actor_type}:${event.actor_id}`
}

function watchlistItemLabel(item: ReturnType<typeof projectWatchlist>[number]): string {
  return item.ticker ?? item.company_id ?? item.watchlist_item_id
}

function holdingLabel(holding: ReturnType<typeof projectHoldings>[number]): string {
  return holding.ticker ?? holding.company_id ?? holding.holding_id
}

function dateToUtcDay(date: string): number | undefined {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (match === null) {
    return undefined
  }

  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function daysBetween(asOf: string, target: string): number | undefined {
  const asOfUtcDay = dateToUtcDay(asOf)
  const targetUtcDay = dateToUtcDay(target)
  if (asOfUtcDay === undefined || targetUtcDay === undefined) {
    return undefined
  }

  return Math.round((targetUtcDay - asOfUtcDay) / 86_400_000)
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildHoldingReviewPrompts(
  holdings: ReturnType<typeof projectHoldings>,
  asOf: string,
): CommandCenterHoldingReviewPrompt[] {
  return holdings
    .filter((holding) => holding.next_review_at !== undefined && holding.pending_review_id === undefined)
    .map((holding) => {
      const daysUntilReview = daysBetween(asOf, holding.next_review_at ?? '')
      if (daysUntilReview === undefined || holding.next_review_at === undefined) {
        return undefined
      }

      return {
        holding_id: holding.holding_id,
        label: holdingLabel(holding),
        next_review_at: holding.next_review_at,
        status: daysUntilReview <= 0 ? 'due' : 'upcoming',
        days_until_review: daysUntilReview,
      } satisfies CommandCenterHoldingReviewPrompt
    })
    .filter((prompt): prompt is CommandCenterHoldingReviewPrompt => prompt !== undefined)
    .sort((left, right) => left.days_until_review - right.days_until_review || left.label.localeCompare(right.label))
}

export function projectCommandCenterSummary(
  events: LedgerEventEnvelope<unknown>[],
  { as_of: asOf = currentDate() }: CommandCenterProjectionOptions = {},
): CommandCenterSummary {
  const researchCases = projectResearchCases(events)
  const watchlist = projectWatchlist(events)
  const holdings = projectHoldings(events)
  const heldWatchlistItemIds = new Set(holdings.map((holding) => holding.watchlist_item_id))
  const pendingDraftItems = watchlist.filter((item) => !item.user_approved)
  const pendingHoldingReviewDrafts = holdings.filter((holding) => holding.pending_review_id !== undefined)
  const holdingReviewPrompts = buildHoldingReviewPrompts(holdings, asOf)
  const dueHoldingReviewPrompt = holdingReviewPrompts.find((prompt) => prompt.status === 'due')
  const upcomingHoldingReviewPrompt = holdingReviewPrompts.find((prompt) => prompt.status === 'upcoming')
  const confirmedWatchlistItems = watchlist.filter((item) => item.user_approved && !heldWatchlistItemIds.has(item.watchlist_item_id))
  const nextRecommendedAction = pendingDraftItems[0] !== undefined
    ? `Review ${watchlistItemLabel(pendingDraftItems[0])} watchlist draft and confirm it`
    : pendingHoldingReviewDrafts[0] !== undefined
      ? `Confirm the drafted strategy review for ${holdingLabel(pendingHoldingReviewDrafts[0])}`
      : dueHoldingReviewPrompt !== undefined
        ? `Run scheduled strategy review for ${dueHoldingReviewPrompt.label} (due ${dueHoldingReviewPrompt.next_review_at})`
        : upcomingHoldingReviewPrompt !== undefined
          ? `Next scheduled strategy review for ${upcomingHoldingReviewPrompt.label} is ${upcomingHoldingReviewPrompt.next_review_at}`
          : confirmedWatchlistItems.length > 0
            ? 'Monitor confirmed watchlist items for buy-zone and thesis updates'
            : holdings.length > 0
              ? 'Review opened holdings for thesis health and sizing'
              : researchCases[0]?.next_required_action ?? 'Review the demo workflow status'
  const pendingUserActionCount = pendingDraftItems.length + pendingHoldingReviewDrafts.length

  return {
    pipeline_counts: {
      research_cases: researchCases.length,
      watchlist_drafts: pendingDraftItems.length,
      confirmed_watchlist_items: confirmedWatchlistItems.length,
      open_holdings: holdings.length,
      pending_user_actions: pendingUserActionCount,
    },
    ...(researchCases[0] === undefined ? {} : { primary_research_case_id: researchCases[0].research_case_id }),
    next_recommended_action: nextRecommendedAction,
    holding_review_prompts: holdingReviewPrompts,
    recent_activity: events
      .slice(-3)
      .reverse()
      .map((event) => ({
        event_id: event.event_id,
        label: `${event.event_type} by ${actorLabel(event)}`,
      })),
  }
}
