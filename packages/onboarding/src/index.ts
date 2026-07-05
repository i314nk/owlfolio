// @owlfolio/onboarding — framework-agnostic onboarding/config/provider core.
//
// Extracted out of apps/web/src/lib so the web app, the CLI (@owlfolio/cli), and
// (later) the worker share one source of truth for app config, env-key storage,
// provider readiness/status, mode init, and the onboarding gate. The old web lib
// paths remain as thin re-export shims so existing importers are unaffected.
//
// Modules are added here incrementally (see plan slices S1–S4). This barrel
// re-exports the public surface as each module lands.

export * from './appConfigStore'
export * from './envKeys'
export * from './providerReadiness'
export * from './providerStatus'
export * from './providerKeys'
export * from './providerConnections'
export * from './demoSeed'
export * from './demoLedger'
export * from './onboarding'
export * from './onboardingGate'
export * from './capital'
