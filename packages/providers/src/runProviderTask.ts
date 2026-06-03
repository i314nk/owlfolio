import type { Provider, ProviderRunResult, ProviderRunRequest } from './providerContract'

export async function runProviderTask(provider: Provider, request: ProviderRunRequest): Promise<ProviderRunResult> {
  const run = await provider.runWithTools(request)

  return {
    metadata: run.metadata,
    text: run.text,
    observations: run.observations,
    tool_calls: run.tool_calls,
    finish_reason: run.finish_reason,
    ledger_events_written: 0,
  }
}
