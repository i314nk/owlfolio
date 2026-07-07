/**
 * Maps a thrown error message from the discovery triage workflow to an HTTP status.
 *
 * 409 (conflict) covers the uninitialized-workflow guard plus every illegal-transition
 * and unknown-candidate guard raised by the discovery candidate workflow:
 *   - "Personal-local workflow is not initialized" (store guard)
 *   - "Unknown discovery candidate: <id>"           (accept/reject not-found)
 *   - "Discovery candidate <id> not found"          (promote web-wrapper not-found)
 *   - "... must be newly discovered ..."            (queue guard)
 *   - "... must be queued for quick screen ..."     (promote guard)
 *   - "... can only be rejected ..."                (reject terminal-state guard)
 * Anything else is an unexpected failure → 500.
 */
export function statusFor(message: string): number {
  if (message.startsWith('Personal-local workflow is not initialized')) return 409
  if (/must be|not found|unknown discovery candidate|can only be rejected/i.test(message)) return 409
  return 500
}
