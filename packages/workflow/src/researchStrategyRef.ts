export type ResearchStrategyRef = {
  strategy_id: string
  strategy_version: string
}

export const defaultResearchStrategyRef: ResearchStrategyRef = {
  strategy_id: 'buffett-munger',
  strategy_version: '1.0.0',
}

export function resolveResearchStrategyRef(input: { strategy_id: string; strategy_version?: string }): ResearchStrategyRef {
  const strategyId = input.strategy_id.trim()
  if (strategyId.length === 0) {
    throw new Error('Research strategy id is required')
  }

  if (input.strategy_version !== undefined) {
    const strategyVersion = input.strategy_version.trim()
    if (strategyVersion.length === 0) {
      throw new Error(`Research strategy ${strategyId} requires a non-empty strategy version`)
    }

    return {
      strategy_id: strategyId,
      strategy_version: strategyVersion,
    }
  }

  if (strategyId === defaultResearchStrategyRef.strategy_id) {
    return defaultResearchStrategyRef
  }

  throw new Error(`Research strategy ${strategyId} requires an explicit strategy version`)
}
