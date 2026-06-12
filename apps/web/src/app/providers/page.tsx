import { redirect } from 'next/navigation'

/**
 * /providers is RETIRED. Its trust/certification detail was folded into /settings/providers as a per-
 * provider "Trust & certification" section. This route now permanently redirects there so old links,
 * bookmarks, and in-app references keep working with a single provider surface.
 */
export default function ProvidersPage(): never {
  redirect('/settings/providers')
}
