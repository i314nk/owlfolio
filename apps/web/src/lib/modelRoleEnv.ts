/**
 * Server-only re-export of the shared model-role env-file plumbing. The implementation lives in
 * `@owlfolio/strategies/modelRoleEnvFile` so BOTH the web run paths AND the worker (which cannot import
 * from apps/web) share one reader. This thin web module keeps the import site local to apps/web/lib.
 *
 * These helpers make the UI-managed `OWLFOLIO_MODEL_ROLE_*` entries in the local env file
 * (~/.owlfolio/.env, or `OWLFOLIO_ENV_FILE`) take effect in the research run paths: the file's role
 * overrides win over process.env for those keys (the file is the selector's source of truth), and only
 * the role keys are ever read — provider secrets in the same file are never touched.
 */
export {
  MODEL_ROLE_ENV_PREFIX,
  isKnownModelRoleEnvKey,
  isModelRoleEnvKey,
  modelRoleEnvKeyForRole,
  readModelRoleOverridesFromEnvFile,
  resolveModelRoleEnv,
  resolveModelRoleEnvFilePath,
  type ModelRoleEnvFileOptions,
  type ResolveModelRoleEnvOptions,
} from '@owlfolio/strategies/modelRoleEnvFile'
