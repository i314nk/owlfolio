import { redirect } from 'next/navigation'

/**
 * /onboarding is RETIRED. The standalone onboarding wizard was fully superseded by the guided-setup
 * surface at /settings/providers (mode toggle, provider/model selection, key guidance, and
 * readiness). This route now permanently redirects there so old links, bookmarks, and in-app references
 * keep working with a single setup surface.
 */
export default function OnboardingPage(): never {
  redirect('/settings/providers')
}
