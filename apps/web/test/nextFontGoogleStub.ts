// Test stub for `next/font/google`. Next transforms these named font loaders
// via its SWC plugin at build time; under vitest there is no such transform, so
// the real module's named exports are not callable. This stub returns the same
// NextFont shape (className + variable + style) for any font loader name, which
// lets modules that wire fonts at import scope (e.g. AppShell) load in tests.
const fontLoader = () => ({
  className: 'mock-font',
  variable: 'mock-font-variable',
  style: { fontFamily: 'mock-font' },
})

export const Fraunces = fontLoader
export const Hanken_Grotesk = fontLoader
export const JetBrains_Mono = fontLoader

export default fontLoader
