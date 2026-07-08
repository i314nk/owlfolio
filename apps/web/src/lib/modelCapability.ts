// The saved answer to "is this routed model capable?" — read back from the target-specific
// certification reports the capability probe (and the full audit) persist. This is the read side of
// the probe: verify once, and the model-selection surface shows the recorded verdict from then on.

import { getLatestProviderCertificationReports } from './providerStatus'

export type ModelCapabilityNote =
  | { state: 'capable'; summary: string; verified_at: string }
  | { state: 'failed'; summary: string; verified_at: string }
  | { state: 'unverified' }

/**
 * The latest recorded capability verdict for (provider, model): 'capable' when the most recent
 * completed target-specific report passed every scenario it ran, 'failed' when any scenario failed,
 * 'unverified' when no completed report exists. Fail-closed to 'unverified' on any read problem.
 */
export async function getModelCapabilityNote(providerId: string, modelId: string | undefined): Promise<ModelCapabilityNote> {
  if (modelId === undefined || modelId.length === 0) return { state: 'unverified' }
  try {
    const reports = await getLatestProviderCertificationReports()
    const matching = reports
      .filter((report) => report.provider_id === providerId
        && report.target?.model_id === modelId
        && report.run_status === 'completed'
        && Array.isArray(report.cases) && report.cases.length > 0)
      .sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1))
    const latest = matching[0]
    if (latest === undefined) return { state: 'unverified' }
    const total = latest.cases.length
    const passed = latest.cases.filter((entry) => entry.passed).length
    const summary = `${passed}/${total} probe scenarios passed`
    return passed === total
      ? { state: 'capable', summary, verified_at: latest.generated_at }
      : { state: 'failed', summary, verified_at: latest.generated_at }
  } catch {
    return { state: 'unverified' }
  }
}
