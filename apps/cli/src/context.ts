// Everything a command needs, injectable so commands are unit-testable without real stdio.
// `out` is the line writer (defaults to console.log); `cwd`/`env` are threaded into the
// @owlfolio/onboarding read functions so tests can point at an isolated project dir. The CLI is
// non-interactive (inspect / diagnose / launch), so there is no prompt/IO surface.
export type CliContext = {
  out: (line: string) => void
  cwd: string
  env: NodeJS.ProcessEnv
}
