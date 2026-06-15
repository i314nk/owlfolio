/**
 * Surface the API error to the user. The /api/research/start route returns errors in two shapes:
 * a bare string, OR an object `{ error: { code, message } }` (e.g. the pre-spend circle gate's
 * `out_of_circle`, whose `message` names WHICH axis — sector/size/archetype/market-cap — rejected the
 * candidate). The old intake form only rendered string errors, so an object error fell through to the
 * generic "Unable to create research case" and the user never saw the specific reason. Handle both
 * shapes generally so any object-shaped error displays its `message`.
 */
export function resolveErrorMessage(body: unknown): string {
  if (body !== null && typeof body === 'object' && 'error' in body) {
    const error = (body as { error: unknown }).error
    if (typeof error === 'string' && error.length > 0) {
      return error
    }
    if (error !== null && typeof error === 'object' && 'message' in error) {
      const message = (error as { message: unknown }).message
      if (typeof message === 'string' && message.length > 0) {
        return message
      }
    }
  }
  return 'Unable to create research case'
}
