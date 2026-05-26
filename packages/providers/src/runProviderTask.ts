import type { Provider, ProviderRunResult, ProviderTaskRequest } from './providerContract'

export async function runProviderTask(provider: Provider, request: ProviderTaskRequest): Promise<ProviderRunResult> {
  const run = await provider.runWithTools(request)

  return {
    metadata: run.metadata,
    text: run.text,
    tool_calls: run.tool_calls,
    ledger_events_written: 0,
  }
}
